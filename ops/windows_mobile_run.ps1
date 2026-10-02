$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$runtimePath = Join-Path $root '.uvms-runtime.json'

function Get-LanIPv4 {
    try {
        $candidate = Get-NetIPConfiguration |
            Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address -and $_.NetAdapter.Status -eq 'Up' } |
            ForEach-Object { $_.IPv4Address.IPAddress } |
            Where-Object { $_ -and $_ -notlike '127.*' -and $_ -notlike '169.254.*' } |
            Select-Object -First 1
        if ($candidate) { return $candidate }
    } catch { }
    throw 'Could not detect a LAN IPv4 address. Run ipconfig and set EXPO_PUBLIC_API_URL manually.'
}

function Test-PortFree([int]$Port) {
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start(); return $true
    } catch { return $false }
    finally { if ($listener) { try { $listener.Stop() } catch { } } }
}

function Get-FreePort([int]$Preferred) {
    for ($port = $Preferred; $port -lt ($Preferred + 30); $port++) {
        if (Test-PortFree $port) { return $port }
    }
    throw "Could not find a free API port near $Preferred."
}

if (-not (Test-Path '.venv\Scripts\python.exe')) { throw 'Python virtual environment is missing. Run QUICK_SETUP_WINDOWS.bat first.' }
if (-not (Test-Path 'apps\mobile\node_modules')) { throw 'Mobile node_modules is missing. Run QUICK_SETUP_WINDOWS.bat first.' }

$apiPort = 8002
$apiReady = $false
$runtime = $null
if (Test-Path $runtimePath) {
    try {
        $runtime = Get-Content $runtimePath -Raw | ConvertFrom-Json
        if ($runtime.api_port) { $apiPort = [int]$runtime.api_port }
        $health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$apiPort/live" -TimeoutSec 2
        $apiReady = ($health.StatusCode -eq 200)
    } catch { $apiReady = $false }
}

if (-not $apiReady) {
    $apiPort = Get-FreePort 8002
    Write-Host "Starting THIS checkout's UVMS API on 0.0.0.0:$apiPort ..." -ForegroundColor Cyan
    $apiCommand = "Set-Location '$root\services\api'; & '$root\.venv\Scripts\python.exe' -m alembic upgrade head; if (`$LASTEXITCODE -ne 0) { exit `$LASTEXITCODE }; & '$root\.venv\Scripts\python.exe' -m uvicorn app.main:app --host 0.0.0.0 --port $apiPort --reload"
    $logDir = Join-Path $root '.local-run'
    New-Item -ItemType Directory -Force $logDir | Out-Null
    $apiProcess = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $apiCommand -RedirectStandardOutput (Join-Path $logDir 'api.stdout.log') -RedirectStandardError (Join-Path $logDir 'api.stderr.log')

    $deadline = (Get-Date).AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 700
        try {
            $health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$apiPort/live" -TimeoutSec 2
            $apiReady = ($health.StatusCode -eq 200)
        } catch { }
    } until ($apiReady -or (Get-Date) -gt $deadline)
    if (-not $apiReady) { throw "API did not become ready on port $apiPort. Check .local-run/api.stderr.log." }

    $record = [ordered]@{
      root = $root; version = '1.2.0-stage1-mobile-experience'; started_at = (Get-Date).ToString('o'); api_port = $apiPort; api_wrapper_pid = $apiProcess.Id
    }
    if ($runtime -and $runtime.web_port) { $record.web_port = [int]$runtime.web_port; $record.web_wrapper_pid = $runtime.web_wrapper_pid }
    $record | ConvertTo-Json | Set-Content -Encoding UTF8 $runtimePath
}

$lanIp = Get-LanIPv4
$env:REACT_NATIVE_PACKAGER_HOSTNAME = $lanIp
$apiBase = "http://${lanIp}:$apiPort/api/v1"
$env:EXPO_PUBLIC_API_URL = $apiBase
$webPort = 3001
if ($runtime -and $runtime.web_port) { $webPort = [int]$runtime.web_port }
$webBase = "http://${lanIp}:$webPort"
$env:EXPO_PUBLIC_WEB_URL = $webBase

Write-Host ''
Write-Host 'UVMS AI v1.2.0 — physical phone development' -ForegroundColor Green
Write-Host "API for phone: $apiBase" -ForegroundColor Yellow
Write-Host "Web/share URL: $webBase" -ForegroundColor Yellow
Write-Host 'Phone and PC must be on the same Wi-Fi/private network.' -ForegroundColor Gray
Write-Host 'If Windows Firewall prompts, allow Python/Node only on Private networks.' -ForegroundColor Gray
Write-Host ''

Set-Location "$root\apps\mobile"
npm.cmd start -- --lan --clear
exit $LASTEXITCODE
