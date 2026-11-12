@echo off
rem watchdog.cmd - keeps Bot up, with no window. The scheduled task "Bot" (made by install-autostart.cmd) runs it
rem through bot-watchdog.vbs (hidden) at every login and then every 5 minutes. It decides:
rem   Bot answers on its port                  -> nothing to do (this is almost every run: one quick local check).
rem   data\stay-stopped exists                  -> you stopped Bot with stop-bot.cmd: leave it stopped.
rem   nothing listens on the port               -> start Bot (start-hidden.vbs: no window).
rem   something listens but does not answer for about 1.5 minutes (Bot hung)
rem                                             -> stop that node process only; Bot's own starter loop (start-web.cmd)
rem                                                starts it again, and if that loop had given up, this starts Bot itself.
rem Everything it does is written to data\bot.log with "[watchdog]" in front.
rem The BOT_WATCH_* settings exist only so tests/watchdog.test.js can run it on a fake server; leave them unset.
setlocal
cd /d "%~dp0"
if not defined BOT_WATCH_PORT set "BOT_WATCH_PORT=3000"
if not defined BOT_WATCH_WAIT set "BOT_WATCH_WAIT=60"
if not defined BOT_WATCH_CURL set "BOT_WATCH_CURL=15"
if not defined BOT_WATCH_LOG set "BOT_WATCH_LOG=%~dp0data\bot.log"
if not defined BOT_WATCH_START set "BOT_WATCH_START=wscript.exe //B //Nologo "%~dp0start-hidden.vbs""
set "URL=http://127.0.0.1:%BOT_WATCH_PORT%/api/session"

if exist "%~dp0data\stay-stopped" exit /b 0
curl.exe -s -m %BOT_WATCH_CURL% -o nul "%URL%" && exit /b 0

call :pid
if not defined PID goto start

rem Something holds the port but did not answer. Bot may be starting up or very busy: give it time, then ask again.
call :wait
curl.exe -s -m %BOT_WATCH_CURL% -o nul "%URL%" && exit /b 0
call :pid
if not defined PID goto start

call :log "Bot did not answer on port %BOT_WATCH_PORT% for over a minute (hung). Stopping node PID %PID% so it starts again."
taskkill /PID %PID% /F >nul 2>nul
call :wait
call :pid
rem Its starter loop brought it back: the next run (in 5 minutes) checks that it answers.
if defined PID exit /b 0
call :log "Bot's starter did not bring it back."

:start
call :log "Bot was not running on port %BOT_WATCH_PORT%. Starting it (no window)."
%BOT_WATCH_START%
exit /b 0

rem PID = the process that LISTENS on the port (empty if none). Only that one process is ever stopped.
:pid
set "PID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%BOT_WATCH_PORT% .*LISTENING"') do set "PID=%%p"
exit /b 0

rem ping waits about BOT_WATCH_WAIT seconds; it works with or without a console (timeout.exe needs one).
:wait
set /a "PINGS=BOT_WATCH_WAIT+1"
ping -n %PINGS% 127.0.0.1 >nul
exit /b 0

:log
if not exist "%~dp0data" mkdir "%~dp0data"
for /f "delims=" %%t in ('powershell -NoProfile -Command "(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')"') do set "NOW=%%t"
>>"%BOT_WATCH_LOG%" echo %NOW% [watchdog] %~1
exit /b 0
