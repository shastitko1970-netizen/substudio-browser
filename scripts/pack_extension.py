#!/usr/bin/env python3
"""Zip extension/ into an unsigned .xpi (no secrets, no node_modules)."""

from __future__ import annotations

import argparse
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "extension"


def pack(dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        dest.unlink()
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(SOURCE.rglob("*")):
            if path.is_file() and path.name != ".DS_Store":
                archive.write(path, path.relative_to(SOURCE).as_posix())
    return dest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=ROOT / "dist" / "substudio-companion.xpi",
    )
    args = parser.parse_args()
    out = pack(args.output)
    print(out)


if __name__ == "__main__":
    main()
