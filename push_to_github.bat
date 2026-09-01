@echo off
cd /d "%~dp0"
echo ======================================================
echo   [1/3] Adding files to git...
git add -A
echo   [2/3] Committing V2.9.3 changes...
git commit -m "Update to V2.9.3: Full-featured Xiangqi Suite with Move Recording, Auto Opening Tree, YouTube links, AI Best Move & Speech Eval, Grandmaster Sync"
echo   [3/3] Force pushing to GitHub (origin main)...
git push origin main --force
echo.
if %ERRORLEVEL% equ 0 (
    echo ======================================================
    echo   [SUCCESS] Pushed to GitHub successfully!
    echo   Render is now deploying V2.9.3 automatically.
    echo   Please wait 1-2 minutes and refresh your webpage.
    echo ======================================================
) else (
    echo   [ERROR] Git push failed. Please check network/credentials.
)
echo.
pause