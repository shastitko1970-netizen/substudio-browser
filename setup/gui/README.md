# SubStudio Setup.exe

Windows installer host for the Dia/Arc-style UI (welcome → runtime → installing → done).

`SubStudioBrowser-Setup-*.exe` is a **Go + WebView2** window around `ui/index.html`. It unpacks the overlay zip and runs `setup/Install-SubStudioBrowser.ps1` (`-FetchEsr` by default). No NSIS wizard, no console, no localhost browser tab.

If WebView2 is missing, `ui/Fallback-UI.ps1` opens the same four screens in WPF.

Theme: follows Windows app color mode (`AppsUseLightTheme`) by default, plus a sun/moon toggle. Dark is nocturnal cream (`#14110e` / `#f4efe6`), not a generic dashboard.

Build from the repo root (cross-compiles on Linux):

```bash
python scripts/build_setup.py
```

Firefox ESR is downloaded at install time, so the Setup.exe stays small.
