@echo off
rem Builds dist\VoiceType\VoiceType.exe (a standalone app; no Python needed to run it).
cd /d "%~dp0"
if not exist .venv (
    python -m venv .venv || goto :error
    .venv\Scripts\python -m pip install -r requirements.txt || goto :error
)
.venv\Scripts\python -m pip install pyinstaller pillow || goto :error
.venv\Scripts\python tools\make_icon.py || goto :error
.venv\Scripts\pyinstaller --noconfirm --clean --windowed --name VoiceType ^
    --icon assets\icon.ico --add-data "assets\icon.png;assets" ^
    --collect-all faster_whisper --collect-all ctranslate2 --collect-all onnxruntime ^
    --collect-data sounddevice ^
    voicetype\__main__.py || goto :error
echo.
echo Built: %~dp0dist\VoiceType\VoiceType.exe
goto :eof

:error
echo Build failed.
pause
exit /b 1
