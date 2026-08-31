@echo off
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>nul
if exist "%~dp0server.pid" del "%~dp0server.pid"
echo 已關閉 V2.9 / localhost:3000
pause
