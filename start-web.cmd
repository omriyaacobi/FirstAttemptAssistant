@echo off
rem Double-click to start the orchestrator web page. Close this window (or press Ctrl+C) to stop it.
cd /d "%~dp0"
start "" http://localhost:3000
node server.js
pause
