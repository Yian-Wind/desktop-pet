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

echo Starting Desktop Pet...
call npm run dev

echo.
echo Pet stopped.
pause
