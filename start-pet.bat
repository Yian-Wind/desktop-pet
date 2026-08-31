@echo off
chcp 65001 >nul
title Desktop Pet
cd /d "%~dp0"

if not exist node_modules (
  echo First run: installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo Dependency install failed. Check your Node.js / npm.
    pause
    exit /b 1
  )
)

set "PET_EXE=%~dp0node_modules\electron\dist\electron.exe"
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:PET_EXE }) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo Desktop Pet is already running.
  pause
  exit /b 0
)

echo Starting Desktop Pet...
call npm run dev

echo.
echo Pet stopped.
pause
