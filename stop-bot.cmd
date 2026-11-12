@echo off
rem Stops Bot when it runs in the background (started by start-hidden.vbs or at login). Double-click it.
rem It finds Bot's "node server.js" and stops it together with its hidden starter.
rem It also leaves the file data\stay-stopped, so the watchdog (see install-autostart.cmd) does NOT start Bot again.
rem Starting Bot yourself (start-hidden.vbs or start-web.cmd) removes that file, and the watchdog watches again.
cd /d "%~dp0"
if not exist data mkdir data
type nul > data\stay-stopped
powershell -NoProfile -Command "$n = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'server\.js' }; if (-not $n) { 'Bot is not running.' } else { foreach ($p in $n) { taskkill /PID $p.ParentProcessId /T /F | Out-Null; taskkill /PID $p.ProcessId /T /F 2>$null | Out-Null }; 'Bot stopped. It stays stopped until you start it again (start-hidden.vbs or start-web.cmd).' }"
timeout /t 3 >nul
