@echo off
rem Double-click to remove the scheduled task "Bot" that install-autostart.cmd made: Bot then no longer starts at login
rem and is no longer watched. A Bot that is running now keeps running (stop it with stop-bot.cmd).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart.ps1" remove
echo.
pause
