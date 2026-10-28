@echo off
rem Double-click to start the Bot web page. Close this window (or press Ctrl+C) to stop it.
rem "start-web.cmd nobrowser" starts it without opening a browser tab.
cd /d "%~dp0"

rem Use "node" if Windows can find it; otherwise fall back to where the Node installer puts it.
set "NODE=node"
where node >nul 2>nul || set "NODE=C:\Program Files\nodejs\node.exe"

rem This tells server.js it may restart itself (the Restart button): it then exits with
rem code 75 and the loop below starts it again in this same window.
set "BOT_SUPERVISED=1"

if /i not "%~1"=="nobrowser" start "" http://localhost:3000

:run
"%NODE%" server.js
if %errorlevel%==75 (
  echo.
  echo Restarting Bot...
  goto run
)

rem Any other way of stopping ends here, so a broken change cannot crash again and again.
echo.
echo Bot stopped (exit code %errorlevel%).
echo If it crashed right after you approved a change, you can undo that change with:
echo     git revert HEAD
echo and then double-click start-web.cmd again.
pause
