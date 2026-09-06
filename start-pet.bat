@echo off
chcp 65001 >nul
title Desktop Pet
cd /d "%~dp0"

set "PET_EXE=%~dp0node_modules\electron\dist\electron.exe"

if not exist "%PET_EXE%" (
  echo First run: installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo Dependency install failed. Check your Node.js / npm.
    pause
    exit /b 1
  )
)

if not exist out\main\index.js (
  echo Building app...
  call npm run build
  if errorlevel 1 (
    echo.
    echo Build failed.
    pause
    exit /b 1
  )
)

:: electron.exe is a GUI-subsystem binary: `start` returns immediately and this
:: console exits, so no lingering cmd windows. Launching while the pet is
:: already running is safe - the app's single-instance lock focuses the
:: existing pet and the new process exits silently.
start "" "%PET_EXE%" .
