$ErrorActionPreference = 'SilentlyContinue'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$RuntimePath = Join-Path $Root '.uvms-runtime.json'
if (-not (Test-Path $RuntimePath)) {
  Write-Host 'No UVMS runtime recorded for this folder.' -ForegroundColor Yellow
  exit 0
}
try {
  $runtime = Get-Content $RuntimePath -Raw | ConvertFrom-Json
  foreach ($name in @('web_wrapper_pid','api_wrapper_pid')) {
    $pidValue = $runtime.$name
    if ($pidValue -and (Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue)) {
      & taskkill.exe /PID ([int]$pidValue) /T /F *> $null
    }
  }
} finally {
  Remove-Item $RuntimePath -Force -ErrorAction SilentlyContinue
}
Write-Host 'Stopped Web/API processes started by this UVMS AI folder.' -ForegroundColor Green
