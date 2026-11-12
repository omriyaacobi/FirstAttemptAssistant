' bot-watchdog.vbs
' The scheduled task "Bot" runs this (wscript.exe //B, so even an error can never pop up a box over a game).
' It runs watchdog.cmd with NO window and waits for it (usually under a second). watchdog.cmd starts Bot if it is
' not running and restarts it if it hangs. You never need to double-click this file.
Set shell = CreateObject("WScript.Shell")
folder = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = folder
' 0 = hidden window, True = wait until watchdog.cmd ends. cmd /c needs one more pair of quotes around a path with spaces.
shell.Run "cmd /c """"" & folder & "\watchdog.cmd""""", 0, True
