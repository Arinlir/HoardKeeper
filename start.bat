@echo off
REM HoardKeeper - Windows launcher
REM First run installs dependencies; after that it just starts the dev server.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js was not found on this machine.
  echo Install the LTS build from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies, this takes a minute the first time...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. See the messages above.
    pause
    exit /b 1
  )
)

echo.
echo Starting HoardKeeper at http://localhost:5173
echo Close this window to stop the server.
echo.
call npm run dev
pause
