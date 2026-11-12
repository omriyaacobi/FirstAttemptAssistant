@echo off
rem Double-click to start the Bot web page. Close this window (or press Ctrl+C) to stop it.
rem "start-web.cmd nobrowser" starts it without opening a browser tab.
rem "start-web.cmd nobrowser hidden" is how start-hidden.vbs runs it: with no window (so nothing waits for a key at the end),
rem and it does nothing if Bot already answers on port 3000.
cd /d "%~dp0"

rem Starting Bot on purpose ends a stop made with stop-bot.cmd, so the watchdog (watchdog.cmd) watches it again.
if exist "data\stay-stopped" del "data\stay-stopped"

rem Use "node" if Windows can find it; otherwise fall back to where the Node installer puts it.
set "NODE=node"
where node >nul 2>nul || set "NODE=C:\Program Files\nodejs\node.exe"

rem This tells server.js it may restart itself (the Restart button): it then exits with
rem code 75 and the loop below starts it again in this same window.
set "BOT_SUPERVISED=1"

if /i "%~2"=="hidden" (
  curl.exe -s -m 3 -o nul http://127.0.0.1:3000/api/session && exit /b 0
)

if /i not "%~1"=="nobrowser" start "" http://localhost:3000

rem How Bot ended decides what happens next (the reason is always written in data\bot.log):
rem   75 = the Restart button                      -> start again
rem   76 = it crashed after running fine a while   -> start again
rem    0 = stopped on purpose, or Ctrl+C           -> stay stopped
rem   anything else = it crashed right after starting -> start again, but only 3 times in a row,
rem                   so a broken change cannot crash again and again.
set CRASHES=0

:run
"%NODE%" server.js
set CODE=%errorlevel%
if %CODE%==75 (
  set CRASHES=0
  echo.
  echo Restarting Bot...
  goto run
)
if %CODE%==76 (
  set CRASHES=0
  echo.
  echo Bot crashed after running for a while. The reason is in data\bot.log. Starting it again in 5 seconds...
  timeout /t 5 /nobreak >nul
  goto run
)
if %CODE%==0 goto stopped
if %CODE%==-1073741510 goto stopped
set /a CRASHES+=1
if %CRASHES% GTR 3 goto stopped
echo.
echo Bot stopped unexpectedly (exit code %CODE%). The reason is in data\bot.log.
echo Starting it again in 5 seconds (try %CRASHES% of 3)...
timeout /t 5 /nobreak >nul
goto run

:stopped
if /i "%~2"=="hidden" exit /b %CODE%
echo.
echo Bot stopped (exit code %CODE%). The reason is in data\bot.log.
echo If it crashed right after you approved a change, you can undo that change with:
echo     git revert HEAD
echo and then double-click start-web.cmd again.
pause
