"""VoiceType: press a global shortcut to dictate, press again to transcribe & paste."""
import queue
import sys
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, ttk

import pyperclip

from . import hotkeys
from .audio import WHISPER_RATE, Recorder, play_cue
from .config import CONFIG_PATH, IS_MAC, Settings
from .history import History, format_time
from .paster import paste_text
from .transcriber import LANGUAGES, MODELS, Transcriber

MIN_SECONDS = 0.3

STATUS_COLORS = {
    "loading": "#d4a017",
    "ready": "#2e9d4f",
    "recording": "#d93025",
    "transcribing": "#1a73e8",
    "error": "#d93025",
}


class VoiceTypeApp:
    def __init__(self):
        self.settings = Settings.load()
        self.history = History()
        self.recorder = Recorder()
        self.transcriber = Transcriber()
        self.jobs = queue.Queue()
        self.ui_queue = queue.Queue()
        self.toggle_lock = threading.Lock()
        self.model_ready = threading.Event()
        self.model_failed = threading.Event()
        self.record_started = 0.0
        self.pending = 0

        self.root = tk.Tk()
        self.root.title("VoiceType")
        self.root.minsize(460, 600)
        self._set_window_icon()
        self._build_ui()

        self.listener = hotkeys.HotkeyListener(self.settings.hotkey, self.toggle)

    # ---------- UI ----------
    def _set_window_icon(self):
        base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
        icon = base / "assets" / "icon.png"
        if icon.exists():
            self._icon = tk.PhotoImage(file=str(icon)).subsample(16)  # 1024 -> 64px
            self.root.iconphoto(True, self._icon)

    def _build_ui(self):
        pad = {"padx": 12, "pady": 6}
        frm = ttk.Frame(self.root)
        frm.pack(fill="both", expand=True, padx=8, pady=8)
        frm.columnconfigure(1, weight=1)

        status_row = ttk.Frame(frm)
        status_row.grid(row=0, column=0, columnspan=3, sticky="w", **pad)
        self.dot = tk.Canvas(status_row, width=14, height=14, highlightthickness=0)
        self.dot_id = self.dot.create_oval(2, 2, 12, 12, fill="#999", outline="")
        self.dot.pack(side="left")
        self.status_var = tk.StringVar(value="Starting…")
        ttk.Label(status_row, textvariable=self.status_var,
                  font=("TkDefaultFont", 11, "bold")).pack(side="left", padx=8)

        ttk.Label(frm, text="Shortcut").grid(row=1, column=0, sticky="w", **pad)
        self.hotkey_var = tk.StringVar(value=hotkeys.display(self.settings.hotkey))
        ttk.Label(frm, textvariable=self.hotkey_var,
                  font=("TkDefaultFont", 10, "bold")).grid(row=1, column=1, sticky="w", **pad)
        self.hotkey_btn = ttk.Button(frm, text="Change…", command=self._change_hotkey)
        self.hotkey_btn.grid(row=1, column=2, sticky="e", **pad)

        ttk.Label(frm, text="Model").grid(row=2, column=0, sticky="w", **pad)
        self.model_var = tk.StringVar(value=self.settings.model)
        model_box = ttk.Combobox(frm, textvariable=self.model_var, values=MODELS, state="readonly")
        model_box.grid(row=2, column=1, columnspan=2, sticky="ew", **pad)
        model_box.bind("<<ComboboxSelected>>", lambda e: self._on_model_setting())

        ttk.Label(frm, text="Language").grid(row=3, column=0, sticky="w", **pad)
        self.lang_var = tk.StringVar(value=self.settings.language)
        lang_box = ttk.Combobox(frm, textvariable=self.lang_var, values=LANGUAGES, state="readonly")
        lang_box.grid(row=3, column=1, columnspan=2, sticky="ew", **pad)
        lang_box.bind("<<ComboboxSelected>>", lambda e: self._save(language=self.lang_var.get()))

        ttk.Label(frm, text="Device").grid(row=4, column=0, sticky="w", **pad)
        self.device_var = tk.StringVar(value=self.settings.device)
        dev_values = ["cpu"] if IS_MAC else ["cpu", "cuda"]
        dev_box = ttk.Combobox(frm, textvariable=self.device_var, values=dev_values, state="readonly")
        dev_box.grid(row=4, column=1, columnspan=2, sticky="ew", **pad)
        dev_box.bind("<<ComboboxSelected>>", lambda e: self._on_model_setting())

        self.sounds_var = tk.BooleanVar(value=self.settings.play_sounds)
        self.space_var = tk.BooleanVar(value=self.settings.trailing_space)
        checks = [
            ("Play start/stop sounds", self.sounds_var, "play_sounds"),
            ("Add a space after pasted text", self.space_var, "trailing_space"),
        ]
        for i, (text, var, field) in enumerate(checks):
            ttk.Checkbutton(frm, text=text, variable=var,
                            command=lambda v=var, f=field: self._save(**{f: v.get()})
                            ).grid(row=5 + i, column=0, columnspan=3, sticky="w", padx=12, pady=2)

        self.history_label = ttk.Label(frm)
        self.history_label.grid(row=8, column=0, columnspan=3, sticky="w", padx=12, pady=(10, 2))

        list_frame = ttk.Frame(frm)
        list_frame.grid(row=9, column=0, columnspan=3, sticky="nsew", padx=12)
        list_frame.columnconfigure(0, weight=1)
        list_frame.rowconfigure(0, weight=1)
        self.history_list = tk.Listbox(list_frame, height=7, activestyle="none",
                                       exportselection=False)
        self.history_list.grid(row=0, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(list_frame, orient="vertical", command=self.history_list.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.history_list.configure(yscrollcommand=scroll.set)
        self.history_list.bind("<<ListboxSelect>>", lambda e: self._show_selected())
        self.history_list.bind("<Double-Button-1>", lambda e: self._copy_selected())
        frm.rowconfigure(9, weight=1)

        self.detail_text = tk.Text(frm, height=4, wrap="word", state="disabled")
        self.detail_text.grid(row=10, column=0, columnspan=3, sticky="nsew", padx=12, pady=(6, 0))

        btns = ttk.Frame(frm)
        btns.grid(row=11, column=0, columnspan=3, sticky="ew", padx=12, pady=6)
        self.copy_btn = ttk.Button(btns, text="Copy", command=self._copy_selected)
        self.copy_btn.pack(side="left")
        self.delete_btn = ttk.Button(btns, text="Delete", command=self._delete_selected)
        self.delete_btn.pack(side="left", padx=6)
        self.clear_btn = ttk.Button(btns, text="Clear all", command=self._clear_history)
        self.clear_btn.pack(side="right")

        ttk.Label(frm, foreground="#777",
                  text=f"Settings: {CONFIG_PATH}").grid(row=12, column=0, columnspan=3,
                                                        sticky="w", padx=12, pady=(0, 4))
        self._refresh_history()

    def _set_status(self, state, text):
        self.status_var.set(text)
        self.dot.itemconfigure(self.dot_id, fill=STATUS_COLORS.get(state, "#999"))

    def ui(self, fn, *args):
        """Schedule fn on the Tk thread (Tk is not thread-safe)."""
        self.ui_queue.put((fn, args))

    def _drain_ui_queue(self):
        try:
            while True:
                fn, args = self.ui_queue.get_nowait()
                fn(*args)
        except queue.Empty:
            pass
        if self.recorder.recording:
            secs = int(time.time() - self.record_started)
            self._set_status("recording", f"Recording… {secs // 60}:{secs % 60:02d}")
        self.root.after(50, self._drain_ui_queue)

    def _idle_status(self):
        if self.recorder.recording:
            return
        if self.pending:
            self._set_status("transcribing", "Transcribing…")
        elif self.model_failed.is_set():
            self._set_status("error", "Model failed to load; pick another model/device")
        elif not self.model_ready.is_set():
            self._set_status("loading", f"Loading model '{self.settings.model}'…")
        else:
            self._set_status("ready", f"Ready: press {hotkeys.display(self.settings.hotkey)}")

    # ---------- history ----------
    def _add_history(self, text):
        self.history.add(text)
        self._refresh_history(select=0)

    def _refresh_history(self, select=None):
        entries = self.history.entries
        self.history_label.configure(
            text=f"History ({len(entries)}/{self.history.limit}): double-click to copy")
        self.history_list.delete(0, "end")
        for e in entries:
            preview = " ".join(e["text"].split())
            if len(preview) > 70:
                preview = preview[:69] + "…"
            self.history_list.insert("end", f"{format_time(e['time'])}   {preview}")
        if select is not None and entries:
            select = min(select, len(entries) - 1)
            self.history_list.selection_set(select)
            self.history_list.see(select)
        self.clear_btn.configure(state="normal" if entries else "disabled")
        self._show_selected()

    def _selected_index(self):
        sel = self.history_list.curselection()
        return sel[0] if sel else None

    def _show_selected(self):
        i = self._selected_index()
        text = self.history.entries[i]["text"] if i is not None else ""
        self.detail_text.configure(state="normal")
        self.detail_text.delete("1.0", "end")
        self.detail_text.insert("1.0", text)
        self.detail_text.configure(state="disabled")
        state = "normal" if i is not None else "disabled"
        self.copy_btn.configure(state=state)
        self.delete_btn.configure(state=state)

    def _copy_selected(self):
        i = self._selected_index()
        if i is None:
            return
        pyperclip.copy(self.history.entries[i]["text"])
        self.history_label.configure(text="Copied to clipboard")
        self.root.after(1500, lambda: self._refresh_history(select=self._selected_index()))

    def _delete_selected(self):
        i = self._selected_index()
        if i is not None:
            self.history.delete(i)
            self._refresh_history(select=i)

    def _clear_history(self):
        if messagebox.askyesno("VoiceType", "Delete all transcription history?", parent=self.root):
            self.history.clear()
            self._refresh_history()

    # ---------- settings ----------
    def _save(self, **changes):
        for k, v in changes.items():
            setattr(self.settings, k, v)
        self.settings.save()

    def _on_model_setting(self):
        self._save(model=self.model_var.get(), device=self.device_var.get())
        self._load_model_async()

    def _change_hotkey(self):
        self.hotkey_btn.configure(state="disabled")
        self.hotkey_var.set("Press the new shortcut… (Esc to cancel)")
        self.listener.capture_next(lambda combo: self.ui(self._hotkey_captured, combo))

    def _hotkey_captured(self, combo):
        if combo:
            self._save(hotkey=combo)
            self.listener.set_hotkey(combo)
        self.hotkey_var.set(hotkeys.display(self.settings.hotkey))
        self.hotkey_btn.configure(state="normal")
        self._idle_status()

    # ---------- model ----------
    def _load_model_async(self):
        self.model_ready.clear()
        self.model_failed.clear()
        self._idle_status()
        name, device = self.settings.model, self.settings.device

        def work():
            try:
                self.transcriber.load(name, device)
            except Exception as e:
                print(f"[model] failed to load {name} on {device}: {e}")
                if (name, device) == (self.settings.model, self.settings.device):
                    self.model_failed.set()
                    self.ui(self._set_status, "error", f"Model error: {e}")
                return
            if (name, device) == (self.settings.model, self.settings.device):
                self.model_ready.set()
                self.ui(self._idle_status)

        threading.Thread(target=work, daemon=True).start()

    # ---------- recording / transcription ----------
    def toggle(self):
        """Called from the hotkey thread each time the shortcut is pressed."""
        with self.toggle_lock:
            try:
                if self.recorder.recording:
                    audio = self.recorder.stop()
                    if self.settings.play_sounds:
                        play_cue("stop")
                    self.pending += 1
                    self.jobs.put(audio)
                    self.ui(self._idle_status)
                else:
                    if self.settings.play_sounds:
                        play_cue("start", block=True)  # finish beep so it isn't recorded
                    self.record_started = time.time()
                    self.recorder.start()
            except Exception as e:
                print(f"[record] {e}")
                if self.settings.play_sounds:
                    play_cue("error")
                self.ui(self._set_status, "error", f"Microphone error: {e}")

    def _worker(self):
        while True:
            audio = self.jobs.get()
            try:
                self._process(audio)
            except Exception as e:
                print(f"[transcribe] {e}")
                if self.settings.play_sounds:
                    play_cue("error")
                self.ui(self._set_status, "error", f"Transcription error: {e}")
                time.sleep(2)
            finally:
                with self.toggle_lock:
                    self.pending -= 1
                self.ui(self._idle_status)

    def _process(self, audio):
        if len(audio) < MIN_SECONDS * WHISPER_RATE:
            return
        while not self.model_ready.wait(0.2):
            if self.model_failed.is_set():
                raise RuntimeError("no model loaded")
        text = self.transcriber.transcribe(audio, self.settings.language)
        if not text:
            return
        self.ui(self._add_history, text)
        if self.settings.trailing_space:
            text += " "
        self.listener.wait_for_modifiers_released()
        paste_text(text)

    # ---------- run ----------
    def run(self):
        self.listener.start()
        threading.Thread(target=self._worker, daemon=True).start()
        self._load_model_async()
        self._drain_ui_queue()
        try:
            self.root.mainloop()
        finally:
            self.listener.stop()


def main():
    VoiceTypeApp().run()
