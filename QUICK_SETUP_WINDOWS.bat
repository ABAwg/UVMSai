@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops\windows_setup.ps1"
if errorlevel 1 (
  echo.
  echo Setup failed. Read the error above or docs\RUN_WINDOWS.md
  pause
  exit /b 1
)
echo.
echo UVMS AI setup completed successfully.
pause
