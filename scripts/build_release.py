#!/usr/bin/env python3
"""Build v0.x.y artifacts: zip, xpi, updates.json, sha256."""

from __future__ import annotations

import hashlib
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
ADDON_ID = "substudio-companion@substudio.browser"
RELEASES = "https://github.com/shastitko1970-netizen/substudio-browser/releases/download"


def sha(path: Path, algo: str) -> str:
    h = hashlib.new(algo)
    h.update(path.read_bytes())
    return h.hexdigest()


def pack_xpi(dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        dest.unlink()
    source = ROOT / "extension"
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_file() and path.name != ".DS_Store":
                archive.write(path, path.relative_to(source).as_posix())
    return dest


def pack_overlay(dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    include = [
        "VERSION",
        "README.md",
        "LICENSE",
        "mozilla.cfg",
        "defaults",
        "distribution",
        "extension",
        "setup",
        "scripts",
        "licenses",
    ]
    if dest.exists():
        dest.unlink()
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in include:
            path = ROOT / name
            if path.is_file():
                archive.write(path, f"SubStudioBrowser-{VERSION}/{name}")
            else:
                for file in sorted(path.rglob("*")):
                    if file.is_file() and file.suffix not in {".pyc"}:
                        archive.write(file, f"SubStudioBrowser-{VERSION}/{file.relative_to(ROOT).as_posix()}")
    return dest


def main() -> None:
    if not re.fullmatch(r"0\.\d+\.\d", VERSION):
        raise SystemExit(f"bad VERSION {VERSION}")
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    xpi = pack_xpi(dist / f"substudio-companion-{VERSION}.xpi")
    overlay = pack_overlay(dist / f"SubStudioBrowser-{VERSION}.zip")
    updates = {
        "addons": {
            ADDON_ID: {
                "updates": [
                    {
                        "version": VERSION,
                        "update_link": f"{RELEASES}/v{VERSION}/{xpi.name}",
                        "update_hash": f"sha512:{sha(xpi, 'sha512')}",
                        "applications": {"gecko": {"strict_min_version": "128.0"}},
                    }
                ]
            }
        }
    }
    updates_path = dist / "updates.json"
    updates_path.write_text(json.dumps(updates, indent=2) + "\n", encoding="utf-8")
    (dist / f"SubStudioBrowser-{VERSION}.zip.sha256").write_text(
        f"{sha(overlay, 'sha256')}  {overlay.name}\n", encoding="utf-8"
    )
    print(xpi)
    print(overlay)
    print(updates_path)


if __name__ == "__main__":
    main()
