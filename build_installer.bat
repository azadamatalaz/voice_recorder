@echo off
rem Builds the app, then packages it into installer\Output\VoiceType-Setup-<version>.exe
rem Requires Inno Setup 6: winget install JRSoftware.InnoSetup
cd /d "%~dp0"
call "%~dp0build_windows.bat" || exit /b 1

set "ISCC="
for %%P in ("%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" "%ProgramFiles%\Inno Setup 6\ISCC.exe" "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe") do (
    if exist %%P set "ISCC=%%~P"
)
if not defined ISCC (
    echo Inno Setup 6 not found. Install it with: winget install JRSoftware.InnoSetup
    exit /b 1
)
"%ISCC%" installer\VoiceType.iss || exit /b 1
echo.
echo Installer: %~dp0installer\Output
