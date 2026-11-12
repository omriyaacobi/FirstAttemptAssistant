' start-hidden.vbs
' Starts Bot in the BACKGROUND, with no window on the screen (so nothing can pop up over a game, and nothing can be closed by mistake).
' It runs the normal starter (start-web.cmd) hidden. At login the scheduled task "Bot" (made by install-autostart.cmd) starts it through watchdog.cmd, and restarts it if it stops or hangs.
' To stop Bot: double-click stop-bot.cmd. To see what Bot is doing: open data\bot.log. The Restart button in the page still works.
Set shell = CreateObject("WScript.Shell")
folder = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = folder
' cmd /c needs the whole command inside one more pair of quotes when the path has spaces
shell.Run "cmd /c """"" & folder & "\start-web.cmd"" nobrowser hidden""", 0, False
