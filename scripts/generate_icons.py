#!/usr/bin/env python3
"""Draw or import the SubStudio mark (not a Firefox logo) as PNG + ICO."""

from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "extension" / "icons"
SETUP = ROOT / "setup"
BRAND_CANDIDATES = (
    ROOT / "substudio-browser-icon.png",
    ROOT / "brand" / "substudio-browser-icon.png",
    ROOT / "brand" / "Brand.png",
    SETUP / "substudio-browser-icon.png",
    ROOT / "setup" / "gui" / "ui" / "substudio-browser-icon.png",
)

# SubStudio palette — cream / coral / plum, not Arc navy.
INK = (23, 20, 15)
PAPER = (244, 239, 230)
CORAL = (227, 107, 74)
PLUM = (91, 75, 138)


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, width: int, pixels: list[list[tuple[int, int, int, int]]]) -> bytes:
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for r, g, b, a in row:
            raw.extend((r, g, b, a))
    payload = b"\x89PNG\r\n\x1a\n"
    payload += chunk(b"IHDR", struct.pack(">IIBBBBB", width, width, 8, 6, 0, 0, 0))
    payload += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    payload += chunk(b"IEND", b"")
    path.write_bytes(payload)
    return payload


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def paint(size: int) -> list[list[tuple[int, int, int, int]]]:
    pixels: list[list[tuple[int, int, int, int]]] = []
    margin = size * 0.08
    radius = size * 0.22
    for y in range(size):
        row = []
        for x in range(size):
            nx = x / max(size - 1, 1)
            ny = y / max(size - 1, 1)
            inside = True
            if x < margin + radius and y < margin + radius:
                inside = (x - (margin + radius)) ** 2 + (y - (margin + radius)) ** 2 <= radius**2
            elif x > size - margin - radius and y < margin + radius:
                inside = (x - (size - margin - radius)) ** 2 + (y - (margin + radius)) ** 2 <= radius**2
            elif x < margin + radius and y > size - margin - radius:
                inside = (x - (margin + radius)) ** 2 + (y - (size - margin - radius)) ** 2 <= radius**2
            elif x > size - margin - radius and y > size - margin - radius:
                inside = (x - (size - margin - radius)) ** 2 + (y - (size - margin - radius)) ** 2 <= radius**2
            elif x < margin or x > size - margin or y < margin or y > size - margin:
                inside = False

            if not inside:
                row.append((0, 0, 0, 0))
                continue

            r, g, b = INK
            if 0.22 * size < x < 0.58 * size and 0.24 * size < y < 0.76 * size:
                r, g, b = PLUM
            if 0.42 * size < x < 0.78 * size and 0.34 * size < y < 0.80 * size:
                r = lerp(r, CORAL[0], 0.78)
                g = lerp(g, CORAL[1], 0.78)
                b = lerp(b, CORAL[2], 0.78)
            if 0.34 * size < x < 0.46 * size and 0.40 * size < y < 0.62 * size:
                r, g, b = INK
            if ny < 0.28:
                r = lerp(r, PAPER[0], 0.10)
                g = lerp(g, PAPER[1], 0.10)
                b = lerp(b, PAPER[2], 0.10)
            row.append((r, g, b, 255))
        pixels.append(row)
    return pixels


def find_brand_png() -> Path | None:
    for path in BRAND_CANDIDATES:
        if path.is_file() and path.stat().st_size > 32:
            return path
    return None


def scale_brand(path: Path, size: int) -> list[list[tuple[int, int, int, int]]] | None:
    try:
        from PIL import Image
    except ImportError:
        return None
    image = Image.open(path).convert("RGBA")
    image = image.resize((size, size), Image.Resampling.LANCZOS)
    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            row.append(image.getpixel((x, y)))
        pixels.append(row)
    return pixels


def write_ico(path: Path, pngs: list[tuple[int, bytes]]) -> None:
    count = len(pngs)
    header = struct.pack("<HHH", 0, 1, count)
    directory = b""
    offset = 6 + 16 * count
    images = b""
    for size, data in pngs:
        w = 0 if size >= 256 else size
        directory += struct.pack("<BBBBHHII", w, w, 0, 0, 1, 32, len(data), offset)
        images += data
        offset += len(data)
    path.write_bytes(header + directory + images)


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    SETUP.mkdir(parents=True, exist_ok=True)
    brand_src = ROOT / "substudio-browser-icon.png"
    if not brand_src.exists():
        sys.path.insert(0, str(ROOT / "scripts"))
        from paint_brand_icon import main as paint_brand

        paint_brand()
    brand = find_brand_png()
    png_bytes: list[tuple[int, bytes]] = []
    for size in (16, 32, 48, 96, 128, 256):
        pixels = scale_brand(brand, size) if brand else None
        if pixels is None:
            pixels = paint(size)
        data = write_png(ICONS / f"icon-{size}.png", size, pixels)
        if size in (16, 32, 48, 256):
            png_bytes.append((size, data))
    write_ico(SETUP / "substudio-browser.ico", png_bytes)
    source = f"brand {brand}" if brand else "generated cream/coral/plum mark"
    print(f"wrote icons from {source} → {ICONS} and {SETUP / 'substudio-browser.ico'}")


if __name__ == "__main__":
    main()
