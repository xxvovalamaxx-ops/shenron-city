@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing locked dependencies...
  call npm ci
  if errorlevel 1 exit /b %errorlevel%
)
echo Starting Shenron City...
echo Open http://127.0.0.1:9122 in your browser.
start http://127.0.0.1:9122
call npm run dev
pause
