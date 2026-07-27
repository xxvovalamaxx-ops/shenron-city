@echo off
cd /d "%~dp0"
if not exist ".env" if exist ".env.example" (
  echo Creating .env from .env.example...
  copy .env.example .env >nul
)
echo Installing dependencies...
call npm install
if %errorlevel% neq 0 (
  echo npm install failed.
  pause
  exit /b %errorlevel%
)
echo.
echo Starting Shenron City...
echo Open http://127.0.0.1:9122 in your browser.
echo (Add ?mode=demo to use fixture data without Mission Control)
echo.
start http://127.0.0.1:9122
npm run dev
pause
