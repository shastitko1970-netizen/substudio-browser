#!/usr/bin/env python3
"""Paint the SubStudio mark: cream squircle, coral–plum glow, Instrument Serif S."""

from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "substudio-browser-icon.png"
FONT = ROOT / "extension" / "fonts" / "InstrumentSerif-Regular.ttf"

PAPER = (244, 239, 230, 255)
WINDOW = (255, 253, 248, 255)
INK = (23, 20, 15, 255)
CORAL = (227, 107, 74, 255)
PLUM = (91, 75, 138, 255)
AMBER = (242, 196, 140, 255)
CREAM = (244, 239, 230, 255)


def squircle_mask(size: int, radius: float) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def paper_field(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), PAPER)
    pix = img.load()
    rng = random.Random(17140)
    for y in range(size):
        for x in range(size):
            grain = rng.randint(-7, 7)
            r, g, b, a = pix[x, y]
            pix[x, y] = (
                max(0, min(255, r + grain)),
                max(0, min(255, g + grain - 1)),
                max(0, min(255, b + grain - 2)),
                255,
            )
    warm = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    wd = ImageDraw.Draw(warm)
    wd.ellipse((int(size * -0.1), int(size * -0.2), int(size * 0.7), int(size * 0.55)), fill=(255, 220, 190, 40))
    wd.ellipse((int(size * 0.35), int(size * 0.45), int(size * 1.15), int(size * 1.2)), fill=(200, 180, 220, 28))
    return Image.alpha_composite(img, warm)


def blob(size: int, box: tuple[int, int, int, int], color: tuple[int, int, int, int], blur: int) -> Image.Image:
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.ellipse(box, fill=color)
    if blur:
        layer = layer.filter(ImageFilter.GaussianBlur(blur))
    return layer


def paint(size: int = 1024) -> Image.Image:
    field = paper_field(size)
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    vessel = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    cx, cy = size // 2, int(size * 0.50)
    left = blob(size, (cx - 340, cy - 40, cx + 80, cy + 360), (*CORAL[:3], 210), 8)
    right = blob(size, (cx - 80, cy - 30, cx + 340, cy + 370), (*PLUM[:3], 210), 8)
    top = blob(size, (cx - 190, cy - 280, cx + 190, cy - 20), (42, 32, 48, 220), 5)
    core = blob(size, (cx - 130, cy + 20, cx + 130, cy + 260), (*AMBER[:3], 175), 16)
    halo = blob(size, (cx - 240, cy - 20, cx + 240, cy + 300), (*CORAL[:3], 80), 30)

    vessel = Image.alpha_composite(vessel, left)
    vessel = Image.alpha_composite(vessel, right)
    vessel = Image.alpha_composite(vessel, top)
    glow = Image.alpha_composite(glow, halo)
    glow = Image.alpha_composite(glow, core)
    composed = Image.alpha_composite(field, glow)
    composed = Image.alpha_composite(composed, vessel)

    font = ImageFont.truetype(str(FONT), size=int(size * 0.38))
    letter = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(letter)
    text = "S"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) / 2 - bbox[0]
    y = size * 0.52 - th / 2 - bbox[1]
    draw.text((x + 3, y + 5), text, font=font, fill=(23, 20, 15, 50))
    draw.text((x, y), text, font=font, fill=CREAM)
    composed = Image.alpha_composite(composed, letter)

    mask = squircle_mask(size, radius=size * 0.22)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(composed, (0, 0), mask)
    return out


def main() -> None:
    icon = paint(1024).resize((512, 512), Image.Resampling.LANCZOS)
    icon.save(OUT, "PNG", optimize=True, compress_level=9)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
