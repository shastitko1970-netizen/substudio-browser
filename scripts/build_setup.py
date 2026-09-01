#!/usr/bin/env python3
"""Cross-compile the Windows Setup.exe (Go + embedded overlay + HTML UI)."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUI = ROOT / "setup" / "gui"


def sha256_file(path: Path) -> str:
    import hashlib

    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def main() -> None:
    sys.path.insert(0, str(ROOT / "scripts"))
    from build_release import VERSION, pack_overlay

    if shutil.which("go") is None:
        raise SystemExit("go is required to build SubStudioBrowser-Setup.exe")

    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    overlay = pack_overlay(dist / f"SubStudioBrowser-{VERSION}.zip")
    embedded = GUI / "overlay.zip"
    shutil.copy2(overlay, embedded)

    exe_name = f"SubStudioBrowser-Setup-{VERSION}.exe"
    dest = dist / exe_name
    env = os.environ.copy()
    env["GOOS"] = "windows"
    env["GOARCH"] = "amd64"
    env["CGO_ENABLED"] = "0"
    env["GOTOOLCHAIN"] = env.get("GOTOOLCHAIN", "local")
    ldflags = f"-H windowsgui -s -w -X main.productVersion={VERSION}"
    cmd = ["go", "build", "-trimpath", "-ldflags", ldflags, "-o", str(dest), "."]
    print(" ".join(cmd), file=sys.stderr)
    subprocess.run(cmd, cwd=GUI, env=env, check=True)
    checksum = dist / f"{exe_name}.sha256"
    checksum.write_text(f"{sha256_file(dest)}  {exe_name}\n", encoding="utf-8")
    print(dest)
    print(checksum)
    print(f"size={dest.stat().st_size}")


if __name__ == "__main__":
    main()
