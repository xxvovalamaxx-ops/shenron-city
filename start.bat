@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not in PATH.
  echo Download it from https://nodejs.org and try again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm is not installed or not in PATH.
  echo Download Node.js from https://nodejs.org and try again.
  pause
  exit /b 1
)

if not exist node_modules\@dgreenheck (
  echo Installing dependencies...
  call npm ci
  if errorlevel 1 (
    echo.
    echo ERROR: npm ci failed.
    echo Try deleting node_modules and package-lock.json, then run this again.
    pause
    exit /b 1
  )
)

echo Starting Shenron City...
echo Open http://127.0.0.1:9122 in your browser.
start http://127.0.0.1:9122
call npm run dev
pause
