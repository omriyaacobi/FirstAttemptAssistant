@echo off
rem Double-click ONCE (from the main Bot folder) so Bot starts by itself at every login, with no window,
rem and is started again if it stops or hangs. It makes the Windows scheduled task "Bot" (see autostart.ps1 for
rem exactly what the task does). Undo with remove-autostart.cmd. This window is only for the install; Bot never needs it.
rem "-ExecutionPolicy Bypass" lets Windows run autostart.ps1 from this folder for this one command only (it changes no setting).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart.ps1" install
echo.
pause
