@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops\windows_mobile_run.ps1"
if errorlevel 1 pause
