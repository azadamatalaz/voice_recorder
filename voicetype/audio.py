"""Microphone recording and short feedback sounds."""
import threading

import numpy as np
import sounddevice as sd

WHISPER_RATE = 16000
_CUE_RATE = 44100


def _tone(freqs, note_ms=90, volume=0.25):
    out = []
    for f in freqs:
        t = np.arange(int(_CUE_RATE * note_ms / 1000)) / _CUE_RATE
        wave = np.sin(2 * np.pi * f * t)
        fade = min(len(t) // 4, int(_CUE_RATE * 0.01))
        env = np.ones_like(t)
        env[:fade] = np.linspace(0, 1, fade)
        env[-fade:] = np.linspace(1, 0, fade)
        out.append(wave * env)
    return (np.concatenate(out) * volume).astype(np.float32)


CUES = {
    "start": _tone([660, 990]),
    "stop": _tone([990, 660]),
    "error": _tone([220, 180], note_ms=150),
}


def play_cue(name, block=False):
    try:
        sd.play(CUES[name], _CUE_RATE)
        if block:
            sd.wait()
    except Exception as e:  # audio output problems should never break dictation
        print(f"[sound] could not play cue: {e}")


class Recorder:
    """Collects mono float32 audio at 16 kHz (resampling if the mic can't)."""

    def __init__(self):
        self._chunks = []
        self._stream = None
        self._rate = WHISPER_RATE
        self._lock = threading.Lock()

    @property
    def recording(self):
        return self._stream is not None

    def _callback(self, indata, frames, time_info, status):
        with self._lock:
            self._chunks.append(indata[:, 0].copy())

    def start(self):
        self._chunks = []
        try:
            self._rate = WHISPER_RATE
            self._stream = sd.InputStream(samplerate=self._rate, channels=1,
                                          dtype="float32", callback=self._callback)
        except Exception:
            # Some devices only support their native rate; resample later.
            self._rate = int(sd.query_devices(kind="input")["default_samplerate"])
            self._stream = sd.InputStream(samplerate=self._rate, channels=1,
                                          dtype="float32", callback=self._callback)
        self._stream.start()

    def stop(self) -> np.ndarray:
        stream, self._stream = self._stream, None
        if stream is not None:
            stream.stop()
            stream.close()
        with self._lock:
            audio = np.concatenate(self._chunks) if self._chunks else np.zeros(0, np.float32)
            self._chunks = []
        if self._rate != WHISPER_RATE and len(audio):
            n = int(len(audio) * WHISPER_RATE / self._rate)
            audio = np.interp(np.linspace(0, len(audio) - 1, n),
                              np.arange(len(audio)), audio).astype(np.float32)
        return audio
