@echo off
rem Stops Bot when it runs in the background (started by start-hidden.vbs or at login). Double-click it.
rem It finds Bot's "node server.js" and stops it together with its hidden starter.
powershell -NoProfile -Command "$n = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'server\.js' }; if (-not $n) { 'Bot is not running.' } else { foreach ($p in $n) { taskkill /PID $p.ParentProcessId /T /F | Out-Null; taskkill /PID $p.ProcessId /T /F 2>$null | Out-Null }; 'Bot stopped.' }"
timeout /t 3 >nul
