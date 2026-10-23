import sys

from voicetype.config import config_dir


def _redirect_output_if_windowed():
    # A windowed (no-console) build has no stdout/stderr; send logs to a file so
    # prints and download progress bars don't crash.
    if sys.stdout is None or sys.stderr is None:
        log = open(config_dir() / "voicetype.log", "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stdout or log
        sys.stderr = sys.stderr or log
        import faulthandler
        faulthandler.enable(log)  # record native crashes too


def _acquire_single_instance_lock():
    """Return a held lock file, or None if another VoiceType is already running."""
    f = open(config_dir() / "voicetype.lock", "a+")
    try:
        if sys.platform == "win32":
            import msvcrt
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.close()
        return None
    return f


def run():
    _redirect_output_if_windowed()
    lock = _acquire_single_instance_lock()
    if lock is None:
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk()
        root.withdraw()
        messagebox.showinfo("VoiceType", "VoiceType is already running.")
        return
    from voicetype.app import main
    main()


if __name__ == "__main__":
    run()
