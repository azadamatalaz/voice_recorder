"""Global hotkey listener with support for recording a new shortcut.

Hotkeys are stored as plain strings like "ctrl+shift+space". We match on our
own normalized key tokens instead of pynput's GlobalHotKeys because holding
Ctrl/Option changes the reported character (Ctrl+R -> '\\x12', Option+R -> '®'),
which breaks character-based matching. Letters and digits are therefore
resolved from the physical virtual-key code when possible.
"""
import sys
import threading
import time

from pynput import keyboard

IS_MAC = sys.platform == "darwin"
MODIFIERS = ("ctrl", "alt", "shift", "cmd")

_MODIFIER_KEYS = {
    keyboard.Key.ctrl: "ctrl", keyboard.Key.ctrl_l: "ctrl", keyboard.Key.ctrl_r: "ctrl",
    keyboard.Key.alt: "alt", keyboard.Key.alt_l: "alt", keyboard.Key.alt_r: "alt",
    keyboard.Key.shift: "shift", keyboard.Key.shift_l: "shift", keyboard.Key.shift_r: "shift",
    keyboard.Key.cmd: "cmd", keyboard.Key.cmd_l: "cmd", keyboard.Key.cmd_r: "cmd",
}
if hasattr(keyboard.Key, "alt_gr"):
    _MODIFIER_KEYS[keyboard.Key.alt_gr] = "alt"

# macOS ANSI virtual key codes -> characters.
_MAC_VK = {
    0: "a", 1: "s", 2: "d", 3: "f", 4: "h", 5: "g", 6: "z", 7: "x", 8: "c", 9: "v",
    11: "b", 12: "q", 13: "w", 14: "e", 15: "r", 16: "y", 17: "t", 18: "1", 19: "2",
    20: "3", 21: "4", 22: "6", 23: "5", 24: "=", 25: "9", 26: "7", 27: "-", 28: "8",
    29: "0", 30: "]", 31: "o", 32: "u", 33: "[", 34: "i", 35: "p", 37: "l", 38: "j",
    39: "'", 40: "k", 41: ";", 42: "\\", 43: ",", 44: "/", 45: "n", 46: "m", 47: ".",
    50: "`",
}


def _char_from_vk(vk):
    if vk is None:
        return None
    if IS_MAC:
        return _MAC_VK.get(vk)
    if 0x30 <= vk <= 0x39 or 0x41 <= vk <= 0x5A:  # Windows VK_0-9, VK_A-Z
        return chr(vk).lower()
    return None


def normalize(key):
    """Turn a pynput key into a stable token like 'ctrl', 'space', 'f9' or 'r'."""
    if key in _MODIFIER_KEYS:
        return _MODIFIER_KEYS[key]
    if isinstance(key, keyboard.Key):
        return key.name
    if isinstance(key, keyboard.KeyCode):
        char = _char_from_vk(getattr(key, "vk", None))
        if char:
            return char
        if key.char:
            c = key.char
            if len(c) == 1 and 1 <= ord(c) <= 26:  # Ctrl+letter control chars
                return chr(ord(c) + 96)
            return c.lower()
        if key.vk is not None:
            return f"vk{key.vk}"
    return None


def parse(hotkey: str) -> frozenset:
    return frozenset(t.strip().lower() for t in hotkey.split("+") if t.strip())


def serialize(tokens) -> str:
    mods = [m for m in MODIFIERS if m in tokens]
    rest = sorted(t for t in tokens if t not in MODIFIERS)
    return "+".join(mods + rest)


def display(hotkey: str) -> str:
    names = {"ctrl": "Ctrl", "shift": "Shift",
             "alt": "Option" if IS_MAC else "Alt",
             "cmd": "Cmd" if IS_MAC else "Win"}
    parts = []
    for t in hotkey.split("+"):
        parts.append(names.get(t) or (t.upper() if len(t) == 1 else t.replace("_", " ").title()))
    return " + ".join(parts)


class HotkeyListener:
    def __init__(self, hotkey: str, on_trigger):
        self._hotkey = parse(hotkey)
        self._on_trigger = on_trigger
        self._pressed = set()
        self._fired = False
        self._capture_cb = None
        self._captured = set()
        self._lock = threading.Lock()
        self._listener = keyboard.Listener(on_press=self._on_press, on_release=self._on_release)
        self._listener.daemon = True

    def start(self):
        self._listener.start()

    def stop(self):
        self._listener.stop()

    def set_hotkey(self, hotkey: str):
        with self._lock:
            self._hotkey = parse(hotkey)
            self._fired = False

    def capture_next(self, callback):
        """Record the next key combination; callback(hotkey_str or None) on finish.

        Escape cancels. A combo must contain at least one non-modifier key.
        """
        with self._lock:
            self._captured = set()
            self._capture_cb = callback

    def cancel_capture(self):
        with self._lock:
            self._capture_cb = None

    def wait_for_modifiers_released(self, timeout=1.5):
        """Block until no modifiers are held, so a synthetic paste isn't altered."""
        end = time.time() + timeout
        while time.time() < end:
            with self._lock:
                if not any(m in self._pressed for m in MODIFIERS):
                    return
            time.sleep(0.02)

    def _on_press(self, key):
        tok = normalize(key)
        if tok is None:
            return
        fire = False
        with self._lock:
            self._pressed.add(tok)
            if self._capture_cb is not None:
                if tok == "esc":
                    cb, self._capture_cb = self._capture_cb, None
                    threading.Thread(target=cb, args=(None,), daemon=True).start()
                else:
                    self._captured.add(tok)
                return
            if self._pressed == self._hotkey and not self._fired:
                self._fired = True
                fire = True
        if fire:
            # Keep the listener callback fast; do the work elsewhere.
            threading.Thread(target=self._on_trigger, daemon=True).start()

    def _on_release(self, key):
        tok = normalize(key)
        if tok is None:
            return
        done = None
        with self._lock:
            self._pressed.discard(tok)
            if tok in self._hotkey:
                self._fired = False
            if self._capture_cb is not None and self._captured and not self._pressed:
                if any(t not in MODIFIERS for t in self._captured):
                    done = (self._capture_cb, serialize(self._captured))
                    self._capture_cb = None
                else:
                    self._captured = set()  # modifiers only; keep waiting
        if done:
            cb, combo = done
            threading.Thread(target=cb, args=(combo,), daemon=True).start()
