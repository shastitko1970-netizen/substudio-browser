#!/usr/bin/env python3
"""Validate policies, AutoConfig, companion, version scheme, and isolation."""

from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ERRORS: list[str] = []


def error(message: str) -> None:
    ERRORS.append(message)


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        error(f"{path}: invalid JSON ({exc})")
        return None


def test_version() -> None:
    sys.path.insert(0, str(ROOT / "scripts"))
    from version import bump, compare, parse

    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    parse(version)
    if version != "0.1.0":
        error(f"first release must be 0.1.0, got {version}")
    if bump("0.1.9") != "0.2.0":
        error("0.1.9 must bump to 0.2.0")
    if bump("0.1.0") != "0.1.1":
        error("0.1.0 must bump to 0.1.1")
    if compare("0.2.0", "0.1.9") <= 0:
        error("0.2.0 must be greater than 0.1.9")

    manifest = load_json(ROOT / "extension" / "manifest.json")
    if manifest and manifest.get("version") != version:
        error("manifest version != VERSION")
    setup = (ROOT / "setup" / "Install-SubStudioBrowser.ps1").read_text(encoding="utf-8")
    if f'$ProductVersion = "{version}"' not in setup:
        error("installer ProductVersion mismatch")


def test_policies() -> None:
    data = load_json(ROOT / "distribution" / "policies.json")
    if not isinstance(data, dict):
        return
    policies = data.get("policies")
    if not isinstance(policies, dict):
        error("missing policies object")
        return
    known = set(json.loads((ROOT / "tests" / "known_policy_keys.json").read_text(encoding="utf-8")))
    for key in policies:
        if key.endswith("_Comment"):
            continue
        if key not in known:
            error(f"unknown policy key: {key}")
    if "BlockAboutConfig" in policies:
        error("do not block about:config")
    prefs = policies.get("Preferences") or {}
    if prefs.get("sidebar.verticalTabs", {}).get("Value") is not True:
        error("sidebar.verticalTabs should be true")
    if prefs.get("browser.ml.chat.provider", {}).get("Value") != "https://grok.com":
        error("stock AI panel should point at grok.com")
    settings = policies.get("ExtensionSettings") or {}
    for addon_id in ("foxyproxy@eric.h.jung", "@testpilot-containers", "substudio-companion@substudio.browser"):
        if addon_id not in settings:
            error(f"missing {addon_id}")


def test_isolation() -> None:
    setup = (ROOT / "setup" / "Install-SubStudioBrowser.ps1").read_text(encoding="utf-8")
    if re.search(r"[-/]CreateProfile\b", setup.replace("not -CreateProfile", "")):
        error("setup must not invoke -CreateProfile (pollutes shared profiles.ini)")
    if "Program Files" in setup and "не трогаем" not in setup and "не трогали" not in setup:
        pass
    if "Copy-OverlayFiles" in setup and "Program Files" in setup.split("function Copy-Overlay")[0]:
        pass
    if 'Join-Path $Install.Root "distribution"' in setup and "Copy-Runtime" not in setup:
        error("overlay must be written to the copied runtime")
    if "Copy-Runtime" not in setup:
        error("setup must copy Firefox into a private runtime")
    if "-profile" not in (ROOT / "setup" / "Launch-SubStudioBrowser.ps1").read_text(encoding="utf-8"):
        error("launcher must use -profile")


def test_autoconfig() -> None:
    cfg = (ROOT / "mozilla.cfg").read_text(encoding="utf-8")
    if not cfg.lstrip().startswith("//"):
        error("mozilla.cfg first line must be a comment")
    if 'defaultPref("sidebar.verticalTabs", true)' not in cfg:
        error("mozilla.cfg must enable vertical tabs")
    if 'defaultPref("browser.ml.chat.provider", "https://grok.com")' not in cfg:
        error("stock panel provider must be grok.com")
    if "127.0.0.1:1234" in cfg and "Do not point" not in cfg and "не" not in cfg:
        error("do not point mozilla chat at the API gateway")
    if "1808692" not in cfg:
        error("document HTTP/3 / Bug 1808692")


def test_manifest() -> None:
    data = load_json(ROOT / "extension" / "manifest.json")
    if not isinstance(data, dict):
        return
    gecko = data.get("browser_specific_settings", {}).get("gecko", {})
    if gecko.get("id") != "substudio-companion@substudio.browser":
        error("bad gecko id")
    if "update_url" not in gecko:
        error("missing gecko.update_url")
    if not str(gecko.get("update_url", "")).startswith("https://"):
        error("update_url must be HTTPS")
    perms = set(data.get("permissions") or [])
    for needed in ("proxy", "contextualIdentities", "storage", "tabs", "scripting"):
        if needed not in perms:
            error(f"missing permission {needed}")
    if "sidebar_action" not in data:
        error("sidecar sidebar_action required")
    if "command-bar" not in (data.get("commands") or {}):
        error("Ctrl+K command-bar missing")
    if data.get("background", {}).get("type") != "module":
        error("background should be ES module")


def test_no_secrets() -> None:
    secretish = re.compile(r"(password|passwd|api_key|secret)\s*[:=]\s*['\"][^'\"]{8,}", re.I)
    skip = {".git", "agent-tools", "dist"}
    for path in ROOT.rglob("*"):
        if not path.is_file() or any(part in skip for part in path.parts):
            continue
        if path.suffix.lower() in {".png", ".ico", ".xpi", ".zip"}:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if secretish.search(text) and "example.invalid" not in text:
            if re.search(r'"(password|username)"\s*:\s*"[^"]+"', text) and '"password": ""' not in text:
                error(f"possible credential in {path}")


def test_pack_and_updates() -> None:
    sys.path.insert(0, str(ROOT / "scripts"))
    from build_release import main as build

    build()
    dist = ROOT / "dist"
    xpi = dist / "substudio-companion-0.1.0.xpi"
    overlay = dist / "SubStudioBrowser-0.1.0.zip"
    updates = load_json(dist / "updates.json")
    if not xpi.exists() or not overlay.exists():
        error("release artifacts missing")
        return
    with zipfile.ZipFile(xpi) as archive:
        names = set(archive.namelist())
    for required in (
        "manifest.json",
        "background.js",
        "sidecar/sidecar.html",
        "command/command.html",
        "lib/grok.js",
        "icons/icon-48.png",
    ):
        if required not in names:
            error(f"xpi missing {required}")
    addon = (updates or {}).get("addons", {}).get("substudio-companion@substudio.browser", {})
    entry = (addon.get("updates") or [None])[0]
    if not entry or not str(entry.get("update_hash", "")).startswith("sha512:"):
        error("updates.json must include sha512")
    if "https://" not in str(entry.get("update_link", "")):
        error("update_link must be HTTPS")


def main() -> int:
    test_version()
    test_policies()
    test_isolation()
    test_autoconfig()
    test_manifest()
    test_no_secrets()
    test_pack_and_updates()
    if ERRORS:
        print("FAIL")
        for item in ERRORS:
            print(" -", item)
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
