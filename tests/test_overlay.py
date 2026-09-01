#!/usr/bin/env python3
"""Validate policies, AutoConfig, companion, version scheme, and isolation."""

from __future__ import annotations

import json
import re
import shutil
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
    if prefs.get("sidebar.verticalTabs", {}).get("Value") is not False:
        error("sidebar.verticalTabs must stay false — companion owns the tab strip")
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
    if 'defaultPref("sidebar.verticalTabs", false)' not in cfg:
        error("mozilla.cfg must disable stock vertical tabs so the companion owns the strip")
    if 'defaultPref("sidebar.position_start", true)' not in cfg:
        error("Space bar sidebar_action should start on the left")
    if "substudio-chrome.js" not in cfg:
        error("mozilla.cfg must load substudio-chrome.js for the Grok right dock")
    autoconfig = (ROOT / "defaults" / "pref" / "autoconfig.js").read_text(encoding="utf-8")
    if 'pref("general.config.sandbox_enabled", false)' not in autoconfig:
        error("AutoConfig sandbox must be off so the Grok dock can inject")
    if 'defaultPref("browser.ml.chat.provider", "https://grok.com")' not in cfg:
        error("stock panel provider must be grok.com")
    if "127.0.0.1:1234" in cfg and "Do not point" not in cfg and "не" not in cfg:
        error("do not point mozilla chat at the API gateway")
    if "1808692" not in cfg:
        error("document HTTP/3 / Bug 1808692")
    if 'defaultPref("toolkit.legacyUserProfileCustomizations.stylesheets", true)' not in cfg:
        error("mozilla.cfg must allow private-profile userChrome")


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
    for needed in ("proxy", "contextualIdentities", "storage", "tabs", "scripting", "tabHide", "sessions"):
        if needed not in perms:
            error(f"missing permission {needed}")
    sidebar = data.get("sidebar_action") or {}
    if sidebar.get("default_panel") != "nav/nav.html":
        error("sidebar_action must be the Space bar (nav/nav.html), not Grok")
    background = (ROOT / "extension" / "background.js").read_text(encoding="utf-8")
    if "sidecar/sidecar.html" in background and "setPanel" in background.split("openGrok")[1][:400]:
        error("openGrok must not steal sidebar_action from the Space bar")
    if "setPanel" in background and "sidecar/sidecar.html" in background:
        if "sidebarAction.setPanel({ panel: browser.runtime.getURL(\"sidecar/sidecar.html\")" in background:
            error("do not setPanel Grok — that replaces the left tab strip")
    if "command-bar" not in (data.get("commands") or {}):
        error("Ctrl+K command-bar missing")
    if "toggle-sidecar" not in (data.get("commands") or {}):
        error("Ctrl+Shift+G Grok toggle missing")
    if "toggle-grok-panel" not in (data.get("commands") or {}):
        error("Ctrl+\\ Grok panel command missing")
    if data.get("background", {}).get("type") != "module":
        error("background should be ES module")


def test_no_secrets() -> None:
    secretish = re.compile(r"(password|passwd|api_key|secret)\s*[:=]\s*['\"][^'\"]{8,}", re.I)
    skip = {".git", "agent-tools", "dist"}
    for path in ROOT.rglob("*"):
        if not path.is_file() or any(part in skip for part in path.parts):
            continue
        if path.suffix.lower() in {".png", ".ico", ".xpi", ".zip", ".ttf", ".woff2", ".exe"}:
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
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    xpi = dist / f"substudio-companion-{version}.xpi"
    overlay = dist / f"SubStudioBrowser-{version}.zip"
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
        "lib/theme.js",
        "lib/spaces.js",
        "nav/nav.html",
        "nav/nav.js",
        "sidecar/sidecar.css",
        "fonts/InstrumentSerif-Regular.ttf",
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
    with zipfile.ZipFile(overlay) as archive:
        names = archive.namelist()
    if not any(name.endswith("Install-SubStudioBrowser.ps1") for name in names):
        error("overlay zip missing installer")
    if any("/setup/gui/" in name for name in names):
        error("overlay zip must stay lean — Setup.exe UI is not an update payload")
    if not any(name.endswith("chrome/userChrome.css") for name in names):
        error("overlay zip missing chrome/userChrome.css")
    if not any(name.endswith("chrome/userContent.css") for name in names):
        error("overlay zip missing chrome/userContent.css")
    if not any(name.endswith("substudio-chrome.js") for name in names):
        error("overlay zip missing substudio-chrome.js")


def test_installer_ui() -> None:
    html = (ROOT / "setup" / "gui" / "ui" / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "setup" / "gui" / "ui" / "styles.css").read_text(encoding="utf-8")
    setup = (ROOT / "setup" / "Install-SubStudioBrowser.ps1").read_text(encoding="utf-8")
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    for needle in (
        "Install a browser",
        "How should Grok live?",
        "Putting the studio on this machine.",
        "It’s yours.",
        "Fetch Firefox ESR",
        "Copy the Firefox I already have",
        "Install SubStudio",
        "Launch SubStudio",
    ):
        if needle not in html:
            error(f"installer UI missing {needle!r}")
    if "Instrument Serif" not in css or "Inter" not in css:
        error("installer UI must use Instrument Serif + Inter")
    if "#E36B4A".lower() not in css.lower() or "#5B4B8A".lower() not in css.lower():
        error("installer art must use SubStudio coral→plum, not Arc navy")
    if f"$ProductVersion = \"{version}\"" not in setup:
        error("GUI host still calls 0.1.x installer — ProductVersion mismatch")
    if "$GuiProgress" not in setup or "Write-SsbProgress" not in setup:
        error("installer must emit GUI progress for Setup.exe")
    if "FetchEsr" not in setup:
        error("ESR fetch path missing")
    if 'id="btn-theme"' not in html:
        error("installer must have a sun/moon theme toggle")
    if '[data-theme="dark"]' not in css or "#1A1612".lower() not in css.lower() or "#F4EFE6".lower() not in css.lower():
        error("installer dark theme must use paper #1A1612 / ink #F4EFE6, not a #121212 dashboard")
    if "userChrome.css" not in setup or "toolkit.legacyUserProfileCustomizations.stylesheets" not in setup:
        error("installer must ship userChrome into the private profile")
    if "substudio-chrome.js" not in setup:
        error("installer must copy substudio-chrome.js next to mozilla.cfg")
    if 'user_pref("sidebar.verticalTabs", false)' not in setup:
        error("private profile must not enable stock vertical tabs")


def test_theme_system() -> None:
    ui = (ROOT / "extension" / "ui.css").read_text(encoding="utf-8")
    theme = (ROOT / "extension" / "lib" / "theme.js").read_text(encoding="utf-8")
    chrome = (ROOT / "chrome" / "userChrome.css").read_text(encoding="utf-8")
    content = (ROOT / "chrome" / "userContent.css").read_text(encoding="utf-8")
    if "Instrument Serif" not in ui or "Inter" not in ui:
        error("companion UI must use Instrument Serif + Inter")
    if '[data-theme="dark"]' not in ui or "#F4EFE6".lower() not in ui.lower() or "#17140F".lower() not in ui.lower():
        error("companion must share SubStudio cream/ink light+dark tokens")
    if "browser.theme" not in theme or "prefers-color-scheme" not in theme:
        error("companion theme must follow browser.theme / prefers-color-scheme")
    if "#sidebar-main" not in chrome or "display: none" not in chrome:
        error("userChrome must hide the stock vertical tab strip")
    if "#TabsToolbar" not in chrome or "visibility: collapse" not in chrome:
        error("userChrome must hide stock horizontal tabs")
    if "#sidebar-box" not in chrome or "#E36B4A".lower() not in chrome.lower():
        error("userChrome Space bar fallback must be SubStudio coral, not Arc navy")
    if "#substudio-grok-box" not in chrome or "order: 2" not in chrome:
        error("userChrome must dock Grok on the right")
    nav = (ROOT / "extension" / "nav" / "nav.html").read_text(encoding="utf-8")
    nav_css = (ROOT / "extension" / "nav" / "nav.css").read_text(encoding="utf-8")
    spaces = (ROOT / "extension" / "lib" / "spaces.js").read_text(encoding="utf-8")
    if "New Tab" not in nav or 'id="pins"' not in nav:
        error("companion Space bar must include 3x3 pins and New Tab")
    if 'data-space="work"' not in nav or 'data-space="home"' not in nav:
        error("companion Space bar must switch Work and Home")
    if "repeat(3, 1fr)" not in nav_css:
        error("companion pin grid must be 3x3")
    if 'id: "home"' not in spaces or "switchSpace" not in spaces or "pinTab" not in spaces:
        error("spaces.js must implement Home + real pin/space switch")
    if "updateSpaceColor" not in spaces or 'type="color"' not in nav:
        error("each Space must have a user color picker")
    if "#E36B4A".lower() not in spaces.lower() or "#5B4B8A".lower() not in spaces.lower():
        error("default Work space must be coral/plum warmth")
    if "#F4EFE6".lower() not in spaces.lower() or "#17140F".lower() not in spaces.lower():
        error("default Home space must be cream/ink")
    chrome_js = (ROOT / "substudio-chrome.js").read_text(encoding="utf-8")
    if "substudio-companion@substudio.browser" not in chrome_js or "sidecar/sidecar.html" not in chrome_js:
        error("substudio-chrome.js must inject the official Grok sidecar")
    sidecar = (ROOT / "extension" / "sidecar" / "sidecar.html").read_text(encoding="utf-8")
    if "Official xAI" not in sidecar or "Ask Grok about this Space" not in sidecar:
        error("Grok sidecar must keep official xAI chrome")
    if "@-moz-document" not in content:
        error("userContent must be scoped")
    if "url-prefix(http" in content or "url-prefix(\"http" in content:
        error("do not restyle websites in userContent")


ARC_PURPLE = ("#1b1540", "#2a1a4a", "#3a1848", "#5a2040")
SUBSTUDIO_LIGHT = ("#F4EFE6", "#FFFDF8", "#17140F", "#6D6558", "#E36B4A", "#5B4B8A")
SUBSTUDIO_DARK = ("#1A1612", "#221C16", "#F4EFE6", "#B5AA9A", "#F08A68")


def _lower(text: str) -> str:
    return text.lower()


def test_substudio_brand() -> None:
    skip = {".git", "agent-tools", "dist", "node_modules"}
    scanned = 0
    for path in ROOT.rglob("*"):
        if not path.is_file() or any(part in skip for part in path.parts):
            continue
        if path.suffix.lower() not in {".css", ".js", ".html", ".ps1", ".cfg"}:
            continue
        text = _lower(path.read_text(encoding="utf-8", errors="ignore"))
        scanned += 1
        for purple in ARC_PURPLE:
            if purple in text:
                error(f"do not hardcode Arc purple {purple} in {path.relative_to(ROOT)}")
    if scanned < 10:
        error("palette scan found too few source files")

    ui = (ROOT / "setup" / "gui" / "ui" / "styles.css").read_text(encoding="utf-8")
    chrome = (ROOT / "chrome" / "userChrome.css").read_text(encoding="utf-8")
    companion = (ROOT / "extension" / "ui.css").read_text(encoding="utf-8")
    for token in SUBSTUDIO_LIGHT:
        blob = _lower(ui + chrome + companion)
        if token.lower() not in blob:
            error(f"SubStudio light token {token} missing from installer/chrome/companion")
    for token in SUBSTUDIO_DARK:
        if token.lower() not in _lower(ui + companion + chrome):
            error(f"SubStudio dark token {token} missing from installer/chrome/companion")

    gen = (ROOT / "scripts" / "generate_icons.py").read_text(encoding="utf-8")
    if "substudio-browser-icon.png" not in gen:
        error("icon generator must prefer a brand PNG when the user supplies one")
    brand = ROOT / "substudio-browser-icon.png"
    if not brand.exists() or brand.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n" or brand.stat().st_size < 8000:
        error("substudio-browser-icon.png must ship (cream squircle, coral-plum glow, serif S)")
    ico = ROOT / "setup" / "substudio-browser.ico"
    if not ico.exists() or ico.stat().st_size < 200:
        error("setup/substudio-browser.ico missing — Setup.exe and shortcuts must not use the Firefox logo")
    setup = (ROOT / "setup" / "Install-SubStudioBrowser.ps1").read_text(encoding="utf-8")
    if "substudio-browser.ico" not in setup or "identity.icon" not in setup:
        error("installer must brand shortcuts and the private profile with identity.icon")
    if "SubStudioBrowser.exe" not in setup:
        error("installer must ship a branded launcher, not a Firefox-logo shortcut")
    build = (ROOT / "scripts" / "build_setup.py").read_text(encoding="utf-8")
    if "substudio-browser.ico" not in build and "winres" not in build and ".syso" not in build:
        error("Setup.exe build must embed the SubStudio icon")


def test_grok_panel() -> None:
    chrome_js = (ROOT / "substudio-chrome.js").read_text(encoding="utf-8")
    chrome = (ROOT / "chrome" / "userChrome.css").read_text(encoding="utf-8")
    nav = (ROOT / "extension" / "nav" / "nav.html").read_text(encoding="utf-8")
    nav_js = (ROOT / "extension" / "nav" / "nav.js").read_text(encoding="utf-8")
    nav_css = (ROOT / "extension" / "nav" / "nav.css").read_text(encoding="utf-8")
    background = (ROOT / "extension" / "background.js").read_text(encoding="utf-8")
    sidecar = (ROOT / "extension" / "sidecar" / "sidecar.html").read_text(encoding="utf-8")
    setup = (ROOT / "setup" / "Install-SubStudioBrowser.ps1").read_text(encoding="utf-8")
    if "ssbSetGrokOpen" not in chrome_js and "gSubStudioGrok" not in chrome_js:
        error("chrome boot must expose a first-class Grok panel API")
    if "default" not in chrome_js.lower() or "false" not in chrome_js:
        error("Grok panel must default closed on first launch")
    if "ctrlKey" not in chrome_js or "Backslash" not in chrome_js:
        error("chrome must handle Ctrl+\\ to toggle Grok")
    if "substudio-grok-button" not in chrome_js:
        error("chrome must add an omnibox / toolbar Grok toggle")
    if 'ssb-grok="closed"' not in chrome:
        error("userChrome must hide the Grok dock when closed so the page is full width")
    if 'id="grok-toggle"' not in nav:
        error("Space bar footer must have a Grok toggle")
    if "ssb-toggle-grok" not in nav_js and "toggleGrok" not in nav_js:
        error("Space bar must fire the Grok panel toggle")
    if "compact" not in nav_css or "ssb-rail" not in chrome:
        error("left rail must collapse to an icon strip independently of Grok")
    if "toggleGrok" not in background:
        error("companion must toggle Grok, not only open a popup")
    if "close-grok" not in sidecar and 'id="close"' not in sidecar:
        error("Grok sidecar must have a close control")
    if "substudio-bridge.js" not in setup:
        error("installer must copy the chrome↔companion Grok bridge")


def test_setup_exe() -> None:
    if shutil.which("go") is None:
        error("go is required to produce SubStudioBrowser-Setup.exe")
        return
    sys.path.insert(0, str(ROOT / "scripts"))
    from build_setup import main as build_setup

    try:
        build_setup()
    except Exception as exc:
        error(f"build_setup failed: {exc}")
        return
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    exe = ROOT / "dist" / f"SubStudioBrowser-Setup-{version}.exe"
    if not exe.exists():
        error("Setup.exe missing after build_setup")
        return
    if exe.read_bytes()[:2] != b"MZ":
        error("Setup.exe is not a Windows PE")
    if exe.stat().st_size < 1_000_000:
        error("Setup.exe looks too small to contain the overlay + UI")


def main() -> int:
    test_version()
    test_policies()
    test_isolation()
    test_autoconfig()
    test_manifest()
    test_no_secrets()
    test_installer_ui()
    test_theme_system()
    test_grok_panel()
    test_substudio_brand()
    test_pack_and_updates()
    test_setup_exe()
    if ERRORS:
        print("FAIL")
        for item in ERRORS:
            print(" -", item)
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
