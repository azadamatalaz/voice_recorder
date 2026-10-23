"""Transcription history, newest first, persisted as JSON next to the settings."""
import json
import os
from datetime import datetime

from .config import config_dir

HISTORY_PATH = config_dir() / "history.json"
MAX_ENTRIES = 20


class History:
    """Not thread-safe: only use from the Tk thread."""

    def __init__(self, path=HISTORY_PATH, limit=MAX_ENTRIES):
        self.path = path
        self.limit = limit
        self.entries = self._load()

    def _load(self):
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        if not isinstance(data, list):
            return []
        entries = [e for e in data
                   if isinstance(e, dict) and isinstance(e.get("text"), str)
                   and isinstance(e.get("time"), str)]
        return entries[: self.limit]

    def _save(self):
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.entries, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)  # atomic, so a crash can't leave a half-written file

    def add(self, text: str):
        self.entries.insert(0, {"time": datetime.now().isoformat(timespec="seconds"),
                                "text": text})
        del self.entries[self.limit:]
        self._save()

    def delete(self, index: int):
        del self.entries[index]
        self._save()

    def clear(self):
        self.entries = []
        self._save()


def format_time(iso: str) -> str:
    """'14:05' for today, 'Oct 2 14:05' for earlier days."""
    try:
        t = datetime.fromisoformat(iso)
    except ValueError:
        return iso
    if t.date() == datetime.now().date():
        return t.strftime("%H:%M")
    return f"{t.strftime('%b')} {t.day} {t.strftime('%H:%M')}"
