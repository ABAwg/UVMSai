$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

function Require-Command($Name, $Hint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found. $Hint"
  }
}

function Assert-ExitCode($Step) {
  if ($LASTEXITCODE -ne 0) { throw "$Step failed (exit code $LASTEXITCODE)." }
}

Require-Command python "Install Python 3.11+ and enable Add Python to PATH."
Require-Command node "Install Node.js 20+ LTS."
Require-Command npm "Install Node.js 20+ LTS."

& python "$Root\ops\release_verify.py" --mode working-tree
Assert-ExitCode "Release self-verification"

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  $secret = -join ((1..4) | ForEach-Object { [guid]::NewGuid().ToString("N") })
  ((Get-Content ".env" -Raw) -replace '(?m)^UVMS_JWT_SECRET=.*$', ("UVMS_JWT_SECRET=" + $secret)) | Set-Content ".env" -Encoding UTF8
  Write-Host "Created .env with a random JWT secret." -ForegroundColor Green
}

if (-not (Test-Path ".venv")) { python -m venv .venv; Assert-ExitCode "Virtual environment creation" }
$Python = Join-Path $Root ".venv\Scripts\python.exe"
& $Python -m pip install --upgrade pip
Assert-ExitCode "pip upgrade"
& $Python -m pip install -r "services\api\requirements.txt"
Assert-ExitCode "Backend dependency installation"
& $Python -m pip check
Assert-ExitCode "Backend dependency consistency"

Write-Host "Running backend tests..." -ForegroundColor Cyan
Push-Location "services\api"
& $Python -m compileall -q app migrations
Assert-ExitCode "Backend compile"
& $Python -m pytest -q
Assert-ExitCode "Backend tests"
& $Python -m alembic upgrade head
Assert-ExitCode "Database migrations"
& $Python -m alembic check
Assert-ExitCode "Alembic schema drift check"
Pop-Location

Write-Host "Installing and building Web..." -ForegroundColor Cyan
Push-Location "apps\web"
npm.cmd ci --no-audit --no-fund
Assert-ExitCode "Web dependency installation"
npm.cmd test
Assert-ExitCode "Web API/session tests"
npm.cmd run typecheck
Assert-ExitCode "Web typecheck"
npm.cmd run build
Assert-ExitCode "Web build"
Pop-Location

Write-Host "Installing and type-checking Mobile..." -ForegroundColor Cyan
Push-Location "apps\mobile"
npm.cmd ci --no-audit --no-fund
Assert-ExitCode "Mobile dependency installation"
npm.cmd run typecheck
Assert-ExitCode "Mobile typecheck"
Pop-Location

Write-Host "All setup checks passed." -ForegroundColor Green
Write-Host "Next: double-click QUICK_RUN_WINDOWS.bat" -ForegroundColor Green
