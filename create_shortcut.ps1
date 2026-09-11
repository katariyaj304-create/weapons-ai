$WshShell = New-Object -comObject WScript.Shell
$ShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) "Weapons AI.lnk"
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "C:\Users\JITENDRA KATARIYA\Weapons.ai\start_app.bat"
$Shortcut.WorkingDirectory = "C:\Users\JITENDRA KATARIYA\Weapons.ai"
$Shortcut.IconLocation = "shell32.dll,3"
$Shortcut.Save()
Write-Host "Shortcut created at $ShortcutPath"
