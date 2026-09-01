"""0.x version scheme: 0.MINOR.PATCH with PATCH in 0–9, then MINOR += 1."""

from __future__ import annotations

import re

SCHEME = re.compile(r"^0\.([0-9]+)\.([0-9])$")


def parse(version: str) -> tuple[int, int]:
    match = SCHEME.fullmatch(version.strip())
    if not match:
        raise ValueError(f"invalid 0.x version: {version!r}")
    return int(match.group(1)), int(match.group(2))


def bump(version: str) -> str:
    minor, patch = parse(version)
    if patch >= 9:
        return f"0.{minor + 1}.0"
    return f"0.{minor}.{patch + 1}"


def compare(a: str, b: str) -> int:
    am, ap = parse(a)
    bm, bp = parse(b)
    return (am > bm) - (am < bm) or (ap > bp) - (ap < bp)
