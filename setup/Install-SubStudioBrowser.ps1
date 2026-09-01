#Requires -Version 5.1
<#
.SYNOPSIS
  Install SubStudio Browser 0.1.0 into a PRIVATE Firefox copy.

  Never writes policies/AutoConfig into Program Files. Daily Firefox stays clean.
  Uses -profile (absolute path), not -CreateProfile (which would touch shared profiles.ini).
#>
[CmdletBinding()]
param(
    [string]$FirefoxPath,
    [switch]$FetchEsr,
    [switch]$NoDesktopShortcut,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$ProductVersion = "0.1.0"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$AppRoot = Join-Path $env:LOCALAPPDATA "SubStudioBrowser"
$Runtime = Join-Path $AppRoot "runtime"
$ProfileDir = Join-Path $AppRoot "profile"
$OverlayDir = Join-Path $AppRoot "overlay"
$XpiDir = Join-Path $AppRoot "extensions"
$XpiPath = Join-Path $XpiDir "substudio-companion.xpi"
$StateFile = Join-Path $AppRoot "setup-state.json"
$CompanionId = "substudio-companion@substudio.browser"
$VersionFile = Join-Path $AppRoot "VERSION"

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }

function ConvertTo-FileUri([string]$Path) {
    return ([Uri]([System.IO.Path]::GetFullPath($Path))).AbsoluteUri
}

function Get-FirefoxSource {
    if ($FirefoxPath) {
        $exe = (Resolve-Path -LiteralPath $FirefoxPath).Path
        return [pscustomobject]@{ Exe = $exe; Root = Split-Path -Parent $exe; Channel = "custom" }
    }
    $ranked = @(
        @{ Path = "${env:ProgramFiles}\Firefox Developer Edition\firefox.exe"; Channel = "dev" },
        @{ Path = "${env:ProgramFiles}\Mozilla Firefox ESR\firefox.exe"; Channel = "esr" },
        @{ Path = "$env:LOCALAPPDATA\Firefox Developer Edition\firefox.exe"; Channel = "dev" },
        @{ Path = "${env:ProgramFiles}\Mozilla Firefox\firefox.exe"; Channel = "release" },
        @{ Path = "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe"; Channel = "release" },
        @{ Path = "$env:LOCALAPPDATA\Mozilla Firefox\firefox.exe"; Channel = "release" }
    )
    foreach ($item in $ranked) {
        if (Test-Path -LiteralPath $item.Path) {
            return [pscustomobject]@{
                Exe = $item.Path
                Root = Split-Path -Parent $item.Path
                Channel = $item.Channel
            }
        }
    }
    throw "firefox.exe не найден. Поставьте Firefox или используйте -FetchEsr."
}

function Copy-Runtime($Source) {
    New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
    Write-Step "Копирую Firefox ($($Source.Channel)) → $Runtime  (Program Files не трогаем)"
    & robocopy $Source.Root $Runtime /E /XD crashreporter-reports /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    $code = $LASTEXITCODE
    if ($code -ge 8) {
        throw "robocopy failed with exit $code"
    }
    $exe = Join-Path $Runtime "firefox.exe"
    if (-not (Test-Path $exe)) {
        throw "После копирования нет firefox.exe в $Runtime"
    }
    return [pscustomobject]@{ Exe = $exe; Root = $Runtime; Channel = $Source.Channel }
}

function Install-EsrRuntime {
    Write-Step "Скачиваю официальный Firefox ESR (unsigned XPI работает на ESR)"
    $tmp = Join-Path $env:TEMP "firefox-esr-setup.exe"
    $url = "https://download.mozilla.org/?product=firefox-esr-latest-ssl&os=win64&lang=en-US"
    Invoke-WebRequest -Uri $url -OutFile $tmp
    if (Test-Path $Runtime) { Remove-Item $Runtime -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
    & $tmp /ExtractDir=$Runtime
    if (-not (Test-Path (Join-Path $Runtime "firefox.exe"))) {
        throw "ESR extract failed"
    }
    return [pscustomobject]@{ Exe = (Join-Path $Runtime "firefox.exe"); Root = $Runtime; Channel = "esr" }
}

function Pack-Xpi {
    New-Item -ItemType Directory -Force -Path $XpiDir | Out-Null
    $ext = Join-Path $RepoRoot "extension"
    if (Get-Command python -ErrorAction SilentlyContinue) {
        & python (Join-Path $RepoRoot "scripts\pack_extension.py") -o $XpiPath
        return
    }
    if (Get-Command python3 -ErrorAction SilentlyContinue) {
        & python3 (Join-Path $RepoRoot "scripts\pack_extension.py") -o $XpiPath
        return
    }
    $zip = "$XpiPath.zip"
    if (Test-Path $zip) { Remove-Item $zip -Force }
    if (Test-Path $XpiPath) { Remove-Item $XpiPath -Force }
    Compress-Archive -Path (Join-Path $ext "*") -DestinationPath $zip -Force
    Move-Item $zip $XpiPath -Force
}

function Install-Overlay($Install) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Install.Root "distribution") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $Install.Root "defaults\pref") | Out-Null
    $policies = Get-Content (Join-Path $RepoRoot "distribution\policies.json") -Raw -Encoding UTF8
    $policies = $policies.Replace("file:///__SUBSTUDIO_COMPANION_XPI__", (ConvertTo-FileUri $XpiPath))
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllText((Join-Path $Install.Root "distribution\policies.json"), $policies, $utf8)
    Copy-Item (Join-Path $RepoRoot "defaults\pref\autoconfig.js") (Join-Path $Install.Root "defaults\pref\autoconfig.js") -Force
    Copy-Item (Join-Path $RepoRoot "mozilla.cfg") (Join-Path $Install.Root "mozilla.cfg") -Force

    New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
    $userJs = @"
// SubStudio Browser $ProductVersion — dedicated profile only.
user_pref("network.proxy.socks_remote_dns", true);
user_pref("network.http.http3.enable", false);
user_pref("privacy.userContext.enabled", true);
user_pref("privacy.userContext.ui.enabled", true);
user_pref("sidebar.revamp", true);
user_pref("sidebar.verticalTabs", true);
user_pref("browser.ml.chat.enabled", true);
user_pref("browser.ml.chat.provider", "https://grok.com");
user_pref("browser.ml.chat.hideLocalhost", false);
user_pref("browser.startup.homepage", "about:home");
user_pref("browser.startup.page", 1);
user_pref("browser.shell.checkDefaultBrowser", false);
"@
    [IO.File]::WriteAllText((Join-Path $ProfileDir "user.js"), $userJs, $utf8)
    $extDir = Join-Path $ProfileDir "extensions"
    New-Item -ItemType Directory -Force -Path $extDir | Out-Null
    Copy-Item $XpiPath (Join-Path $extDir "$CompanionId.xpi") -Force

    New-Item -ItemType Directory -Force -Path $OverlayDir | Out-Null
    Copy-Item (Join-Path $RepoRoot "VERSION") $VersionFile -Force
}

function New-Shortcut([string]$Path, $Install) {
    New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
    $wsh = New-Object -ComObject WScript.Shell
    $lnk = $wsh.CreateShortcut($Path)
    $launcher = Join-Path $PSScriptRoot "Launch-SubStudioBrowser.ps1"
    $lnk.TargetPath = "powershell.exe"
    $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""
    $lnk.WorkingDirectory = $Install.Root
    $lnk.Description = "SubStudio Browser $ProductVersion"
    $ico = Join-Path $PSScriptRoot "substudio-browser.ico"
    $lnk.IconLocation = $(if (Test-Path $ico) { $ico } else { "$($Install.Exe),0" })
    $lnk.Save()
}

function Uninstall-Private {
    $shortcuts = @(
        (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\SubStudio Browser.lnk"),
        (Join-Path ([Environment]::GetFolderPath("Desktop")) "SubStudio Browser.lnk")
    )
    foreach ($lnk in $shortcuts) {
        if (Test-Path $lnk) { Remove-Item $lnk -Force }
    }
    if (Test-Path $Runtime) {
        Write-Step "Удаляю частную копию Firefox $Runtime"
        Remove-Item $Runtime -Recurse -Force
    }
    Write-Host "Профиль $ProfileDir оставлен. Program Files Firefox не трогали."
}

if ($Uninstall) { Uninstall-Private; return }

$source = $null
$install = $null
if ($FetchEsr) {
    $install = Install-EsrRuntime
} else {
    $source = Get-FirefoxSource
    $install = Copy-Runtime $source
}

Write-Step "Собираю companion 0.1.0"
Pack-Xpi
Install-Overlay $install

$shortcuts = @()
$start = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\SubStudio Browser.lnk"
New-Shortcut $start $install
$shortcuts += $start
if (-not $NoDesktopShortcut) {
    $desk = Join-Path ([Environment]::GetFolderPath("Desktop")) "SubStudio Browser.lnk"
    New-Shortcut $desk $install
    $shortcuts += $desk
}

$utf8 = New-Object System.Text.UTF8Encoding $false
[IO.File]::WriteAllText($StateFile, (@{
    version = $ProductVersion
    runtime = $Runtime
    profile = $ProfileDir
    channel = $install.Channel
    source = $(if ($source) { $source.Exe } else { "esr-download" })
    shortcuts = $shortcuts
} | ConvertTo-Json -Depth 5), $utf8)

Write-Host ""
Write-Host "SubStudio Browser $ProductVersion готов." -ForegroundColor Green
Write-Host "Запуск: $($install.Exe) -profile `"$ProfileDir`" -no-remote"
Write-Host "Политики только в $Runtime\distribution — повседневный Firefox чист."
if ($install.Channel -eq "release") {
    Write-Host ""
    Write-Host "Источник — Firefox Release: unsigned companion не удержится." -ForegroundColor Yellow
    Write-Host "Повторите с Dev Edition / ESR или: Install-SubStudioBrowser.ps1 -FetchEsr"
}
Write-Host "FoxyProxy и Multi-Account Containers подтягиваются с AMO (подписаны)."
