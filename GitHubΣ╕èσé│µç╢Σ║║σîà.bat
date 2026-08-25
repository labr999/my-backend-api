@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==============================================
echo 象棋小棋聖 V2.2 - GitHub 上傳懶人包
echo ==============================================
echo.
where git >nul 2>&1
if errorlevel 1 (
  echo [錯誤] 找不到 Git。
  echo 請安裝 Git for Windows 後再執行。
  pause
  exit /b 1
)
if not exist .git (
  git init
  git branch -M main
)
git add .
git status
echo.
echo 第一次上傳時，請先在 GitHub 建立一個空白 Repository。
echo 然後把 GitHub Repository URL 貼到下面。
set /p URL=GitHub Repository URL: 
if "%URL%"=="" goto END
git remote remove origin >nul 2>&1
git remote add origin "%URL%"
git add .
git commit -m "Xiangqi Web Suite V2.2"
git push -u origin main
:END
echo.
echo 完成。若 push 被 GitHub 要求登入，依 GitHub 視窗登入即可。
pause
