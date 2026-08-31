@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo [錯誤] 尚未安裝 Node.js & pause & exit /b 1)
if not exist node_modules (echo [1/2] 安裝套件... & call npm install)
echo [2/2] 啟動 V2.9.2...
start "象棋小棋聖 V2.9.2" cmd /k "npm start"
timeout /t 3 /nobreak >nul
start "" "http://localhost:3000/"
