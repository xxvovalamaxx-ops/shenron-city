@echo off
cd /d "%~dp0"
echo Installing dependencies...
call npm install
echo Starting Shenron City...
start http://127.0.0.1:9122
npm run dev
pause
