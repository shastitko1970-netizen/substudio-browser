#!/usr/bin/env python3
"""Draw SubStudio marks (not a Firefox logo) as PNG + ICO."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "extension" / "icons"
SETUP = ROOT / "setup"


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
            nx = x / (size - 1)
            ny = y / (size - 1)
            # Transparent corners → rounded tile
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

            # Navy field
            r, g, b = 22, 28, 42
            # Teal window (left)
            if 0.22 * size < x < 0.58 * size and 0.24 * size < y < 0.76 * size:
                r, g, b = 61, 205, 192
            # Overlapping amber pane (right)
            if 0.42 * size < x < 0.78 * size and 0.34 * size < y < 0.80 * size:
                r = lerp(r, 240, 0.72)
                g = lerp(g, 160, 0.72)
                b = lerp(b, 80, 0.72)
            # Inner cut so it reads as two frames, not a blob
            if 0.34 * size < x < 0.46 * size and 0.40 * size < y < 0.62 * size:
                r, g, b = 22, 28, 42
            # Soft top highlight
            if ny < 0.28:
                r = lerp(r, 80, 0.12)
                g = lerp(g, 90, 0.12)
                b = lerp(b, 110, 0.12)
            row.append((r, g, b, 255))
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
    png_bytes: list[tuple[int, bytes]] = []
    for size in (16, 32, 48, 96, 128, 256):
        data = write_png(ICONS / f"icon-{size}.png", size, paint(size))
        if size in (16, 32, 48, 256):
            png_bytes.append((size, data))
    write_ico(SETUP / "substudio-browser.ico", png_bytes)
    print(f"wrote icons in {ICONS} and {SETUP / 'substudio-browser.ico'}")


if __name__ == "__main__":
    main()
