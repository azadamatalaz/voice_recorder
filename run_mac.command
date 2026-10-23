#!/bin/bash
# Double-click in Finder (or run from Terminal) to start VoiceType on macOS.
cd "$(dirname "$0")" || exit 1
if [ ! -d .venv ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv || exit 1
    .venv/bin/python -m pip install --upgrade pip
    .venv/bin/python -m pip install -r requirements.txt || exit 1
fi
exec .venv/bin/python -m voicetype
