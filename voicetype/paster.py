"""Insert text at the current cursor by pasting it through the clipboard."""
import sys
import time

import pyperclip
from pynput.keyboard import Controller, Key, KeyCode

IS_MAC = sys.platform == "darwin"
_PASTE_MOD = Key.cmd if IS_MAC else Key.ctrl
# Physical V key (not the character), so paste works with any keyboard layout.
_V_KEY = KeyCode.from_vk(9 if IS_MAC else 0x56)
_keyboard = Controller()


def paste_text(text: str):
    """Copy text to the clipboard (where it stays) and paste it at the cursor."""
    pyperclip.copy(text)
    time.sleep(0.05)  # let the clipboard settle before the target app reads it
    with _keyboard.pressed(_PASTE_MOD):
        _keyboard.press(_V_KEY)
        _keyboard.release(_V_KEY)
