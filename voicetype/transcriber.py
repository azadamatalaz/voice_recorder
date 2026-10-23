"""Local speech-to-text using faster-whisper (Whisper models, runs offline).

Models are downloaded once from Hugging Face on first use and cached locally.
"""
import threading

import numpy as np

MODELS = ["tiny", "base", "small", "medium", "large-v3-turbo", "large-v3",
          "tiny.en", "base.en", "small.en", "medium.en", "distil-large-v3"]

LANGUAGES = ["auto", "en", "es", "fr", "de", "it", "pt", "nl", "pl", "ru", "uk",
             "tr", "ar", "hi", "ja", "ko", "zh", "vi", "id", "sv", "no", "da", "fi"]


class Transcriber:
    def __init__(self):
        self._model = None
        self._model_key = None
        self._lock = threading.Lock()

    @property
    def loaded_key(self):
        return self._model_key

    def load(self, name: str, device: str):
        from faster_whisper import WhisperModel  # heavy import, keep it lazy

        key = (name, device)
        with self._lock:
            if self._model_key == key:
                return
            self._model = None
            compute_type = "float16" if device == "cuda" else "int8"
            self._model = WhisperModel(name, device=device, compute_type=compute_type)
            self._model_key = key

    def transcribe(self, audio: np.ndarray, language: str = "auto") -> str:
        with self._lock:
            if self._model is None:
                raise RuntimeError("Model is not loaded")
            segments, _info = self._model.transcribe(
                audio,
                language=None if language == "auto" else language,
                beam_size=5,
                vad_filter=True,  # skip silence; reduces hallucinated text
                condition_on_previous_text=False,
            )
            return " ".join(s.text.strip() for s in segments).strip()
