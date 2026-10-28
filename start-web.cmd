@echo off
rem Double-click to start the Bot web page. Close this window (or press Ctrl+C) to stop it.
cd /d "%~dp0"

rem Use "node" if Windows can find it; otherwise fall back to where the Node installer puts it.
set "NODE=node"
where node >nul 2>nul || set "NODE=C:\Program Files\nodejs\node.exe"

start "" http://localhost:3000
"%NODE%" server.js
pause
