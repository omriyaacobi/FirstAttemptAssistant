@echo off
rem power-settings.cmd - keeps this laptop awake so Bot stays available. Double-click it to run.
rem Plugged in: never sleeps, closing the lid does nothing, screen off after 5 minutes.
rem On battery: stays on, closing the lid sleeps, and at 15% it hibernates to protect the battery.
rem Hibernate saves everything to disk and uses no power, so the battery cannot drain to zero.
rem The 80% charge limit is not here: set it in the Lenovo Vantage app.

powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 1

powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 5

powercfg /change standby-timeout-dc 0
powercfg /change hibernate-timeout-dc 0
powercfg /change monitor-timeout-dc 5

powercfg /setdcvalueindex SCHEME_CURRENT SUB_BATTERY BATLEVELLOW 20
powercfg /setdcvalueindex SCHEME_CURRENT SUB_BATTERY BATLEVELCRIT 15
powercfg /setdcvalueindex SCHEME_CURRENT SUB_BATTERY BATACTIONCRIT 2

powercfg /setactive SCHEME_CURRENT

if errorlevel 1 (
  echo Something went wrong. Tell Claude what this window says.
) else (
  echo Done. Tell Claude, and it will check the new settings.
)
pause
