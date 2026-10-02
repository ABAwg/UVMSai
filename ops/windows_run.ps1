$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Version = (Get-Content (Join-Path $Root 'VERSION') -Raw).Trim()
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$RuntimePath = Join-Path $Root ".uvms-runtime.json"
$LogDir = Join-Path $Root '.local-run'
New-Item -ItemType Directory -Force $LogDir | Out-Null

if (-not (Test-Path $Python)) { throw "Run QUICK_SETUP_WINDOWS.bat first." }
if (-not (Test-Path (Join-Path $Root ".env"))) { throw "Missing .env. Run QUICK_SETUP_WINDOWS.bat first." }

function Stop-RecordedRuntime {
  if (-not (Test-Path $RuntimePath)) { return }
  try {
    $runtime = Get-Content $RuntimePath -Raw | ConvertFrom-Json
    foreach ($name in @('web_wrapper_pid','api_wrapper_pid')) {
      $pidValue = $runtime.$name
      if ($pidValue) {
        $process = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
        if ($process) {
          & taskkill.exe /PID ([int]$pidValue) /T /F *> $null
        }
      }
    }
  } catch { }
  Remove-Item $RuntimePath -Force -ErrorAction SilentlyContinue
}

function Test-PortFree([int]$Port) {
  $listener = $null
  try {
    # Windows can bind loopback even while another process listens on 0.0.0.0.
    # Probe the same wildcard address used by Uvicorn and Next, exclusively.
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
    $listener.ExclusiveAddressUse = $true
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($listener) { try { $listener.Stop() } catch { } }
  }
}

function Get-FreePort([int]$Preferred) {
  for ($port = $Preferred; $port -lt ($Preferred + 30); $port++) {
    if (Test-PortFree $port) { return $port }
  }
  throw "Could not find a free port near $Preferred."
}

function Wait-Http([string]$Url, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    Start-Sleep -Milliseconds 600
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
    } catch { }
  } until ((Get-Date) -gt $deadline)
  return $false
}

# Only stop processes previously launched by THIS checkout. Old copies on 3000/8000 are left alone.
Stop-RecordedRuntime

$preferredWeb = 3001
$preferredApi = 8002
if ($env:UVMS_WEB_PORT) { $preferredWeb = [int]$env:UVMS_WEB_PORT }
if ($env:UVMS_API_PORT) { $preferredApi = [int]$env:UVMS_API_PORT }

$webPort = Get-FreePort $preferredWeb
$apiPort = Get-FreePort $preferredApi

$runtimeOrigins = "http://localhost:$webPort,http://127.0.0.1:$webPort"
$apiDir = Join-Path $Root 'services\api'
$webDir = Join-Path $Root 'apps\web'

$api = "`$env:UVMS_CORS_ORIGINS='$runtimeOrigins'; `$env:UVMS_RELEASE_VERSION='$Version'; Set-Location '$apiDir'; & '$Python' -m alembic upgrade head; if (`$LASTEXITCODE -ne 0) { exit `$LASTEXITCODE }; & '$Python' -m uvicorn app.main:app --host 0.0.0.0 --port $apiPort --reload"
$web = "`$env:NEXT_PUBLIC_API_URL='/api/v1'; `$env:UVMS_API_INTERNAL_URL='http://127.0.0.1:$apiPort'; `$env:UVMS_QA='1'; Set-Location '$webDir'; npm.cmd run dev -- -p $webPort -H 0.0.0.0"

$apiProcess = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList "-NoProfile", "-Command", $api -RedirectStandardOutput (Join-Path $LogDir 'api.stdout.log') -RedirectStandardError (Join-Path $LogDir 'api.stderr.log')
if (-not (Wait-Http "http://127.0.0.1:$apiPort/live" 35)) {
  try { & taskkill.exe /PID $apiProcess.Id /T /F *> $null } catch { }
  throw "The current UVMS API did not start on port $apiPort. Check .local-run/api.stderr.log."
}

$webProcess = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList "-NoProfile", "-Command", $web -RedirectStandardOutput (Join-Path $LogDir 'web.stdout.log') -RedirectStandardError (Join-Path $LogDir 'web.stderr.log')
if (-not (Wait-Http "http://127.0.0.1:$webPort" 60)) {
  try { & taskkill.exe /PID $webProcess.Id /T /F *> $null } catch { }
  try { & taskkill.exe /PID $apiProcess.Id /T /F *> $null } catch { }
  throw "The current UVMS Web did not start on port $webPort. Check .local-run/web.stderr.log."
}

$runtime = [ordered]@{
  root = $Root
  version = $Version
  started_at = (Get-Date).ToString('o')
  web_port = $webPort
  api_port = $apiPort
  web_wrapper_pid = $webProcess.Id
  api_wrapper_pid = $apiProcess.Id
}
$runtime | ConvertTo-Json | Set-Content -Encoding UTF8 $RuntimePath

Start-Process "http://localhost:$webPort"
Write-Host "" 
Write-Host "UVMS AI v$Version is running from THIS folder." -ForegroundColor Green
Write-Host "Web: http://localhost:$webPort" -ForegroundColor Cyan
Write-Host "API: http://localhost:$apiPort/docs" -ForegroundColor Cyan
if ($webPort -ne 3000 -or $apiPort -ne 8000) {
  Write-Host "Note: older services on 3000/8000 were not reused. This prevents opening a stale checkout." -ForegroundColor Yellow
}

try {
  $lan = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address -and $_.NetAdapter.Status -eq 'Up' } |
    ForEach-Object { $_.IPv4Address.IPAddress } |
    Where-Object { $_ -and $_ -notlike '127.*' -and $_ -notlike '169.254.*' } |
    Select-Object -First 1
  if ($lan) {
    Write-Host "Mobile API (same Wi-Fi): http://$lan`:$apiPort/api/v1" -ForegroundColor Cyan
  }
} catch { }
