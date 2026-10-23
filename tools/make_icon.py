"""Draw the app icon (a microphone) and save it as assets/icon.ico and icon.png."""
from pathlib import Path

from PIL import Image, ImageDraw

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((40, 40, S - 40, S - 40), radius=220, fill=(26, 115, 232))
white = (255, 255, 255)
d.rounded_rectangle((392, 190, 632, 590), radius=120, fill=white)          # capsule
d.arc((292, 330, 732, 720), start=0, end=180, fill=white, width=48)        # cradle
d.rectangle((488, 720, 536, 830), fill=white)                              # stem
d.rounded_rectangle((372, 810, 652, 860), radius=25, fill=white)           # base

out = Path(__file__).resolve().parent.parent / "assets"
out.mkdir(exist_ok=True)
img.save(out / "icon.png")
img.save(out / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("wrote", out)
