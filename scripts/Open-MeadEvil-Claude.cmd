@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
powershell.exe -NoLogo -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Launch-MeadEvil-Claude.ps1" -OpenInNewWindow %*

endlocal
