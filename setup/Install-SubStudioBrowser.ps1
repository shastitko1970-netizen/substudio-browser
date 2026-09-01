#Requires -Version 5.1
<#
.SYNOPSIS
  Install SubStudio Browser 0.1.1 into a PRIVATE Firefox copy.

  Never writes policies/AutoConfig into Program Files. Daily Firefox stays clean.
  Uses -profile (absolute path), not -CreateProfile (which would touch shared profiles.ini).

  The Dia/Arc Setup.exe UI calls this script. Console Install.cmd still works.
#>
[CmdletBinding()]
param(
    [string]$FirefoxPath,
    [switch]$FetchEsr,
    [switch]$NoDesktopShortcut,
    [switch]$Uninstall,
    [switch]$GuiProgress,
    [string]$ProgressLog
)

$ErrorActionPreference = "Stop"
$ProductVersion = "0.1.1"
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

function Write-SsbProgress {
    param(
        [int]$Percent,
        [string]$Status,
        [string]$Detail
    )
    Write-Step $Detail
    if (-not $GuiProgress -and -not $ProgressLog) { return }
    $payload = @{
        percent = [Math]::Max(0, [Math]::Min(100, $Percent))
        status  = $Status
        detail  = $Detail
        phase   = "working"
    } | ConvertTo-Json -Compress
    Write-Host "##SSB##$payload"
    if ($ProgressLog) {
        $dir = Split-Path -Parent $ProgressLog
        if ($dir -and -not (Test-Path $dir)) {
            New-Item -ItemType Directory -Force -Path $dir | Out-Null
        }
        Add-Content -LiteralPath $ProgressLog -Value $payload -Encoding UTF8
    }
}

function Write-SsbDone {
    param([string]$Channel)
    $payload = @{
        percent = 100
        status  = "Ready"
        detail  = "SubStudio Browser $ProductVersion готов."
        phase   = "done"
        channel = $Channel
    } | ConvertTo-Json -Compress
    Write-Host "##SSB##$payload"
    if ($ProgressLog) {
        Add-Content -LiteralPath $ProgressLog -Value $payload -Encoding UTF8
    }
}

function Write-SsbFail([string]$Message) {
    $payload = @{
        percent = 0
        status  = "Failed"
        detail  = $Message
        phase   = "error"
    } | ConvertTo-Json -Compress
    Write-Host "##SSB##$payload"
    if ($ProgressLog) {
        Add-Content -LiteralPath $ProgressLog -Value $payload -Encoding UTF8
    }
}

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
    Write-SsbProgress 40 "Copying Firefox..." "Копирую Firefox ($($Source.Channel)) → $Runtime  (Program Files не трогаем)"
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

function Get-RemoteFile {
    param(
        [string]$Url,
        [string]$Dest,
        [int]$StartPct,
        [int]$EndPct,
        [string]$Status,
        [string]$Detail
    )
    $request = [System.Net.HttpWebRequest]::Create($Url)
    $request.AllowAutoRedirect = $true
    $request.UserAgent = "SubStudioBrowser/$ProductVersion"
    $response = $request.GetResponse()
    try {
        $total = $response.ContentLength
        $input = $response.GetResponseStream()
        $output = [System.IO.File]::Create($Dest)
        try {
            $buffer = New-Object byte[] (256KB)
            $read = 0L
            while (($n = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $output.Write($buffer, 0, $n)
                $read += $n
                if ($total -gt 0) {
                    $pct = $StartPct + [int](($EndPct - $StartPct) * $read / $total)
                    Write-SsbProgress $pct $Status $Detail
                }
            }
        } finally {
            $output.Dispose()
            $input.Dispose()
        }
    } finally {
        $response.Dispose()
    }
}

function Install-EsrRuntime {
    Write-SsbProgress 8 "Fetching Firefox ESR..." "Скачиваю официальный Firefox ESR (unsigned XPI работает на ESR)"
    $tmp = Join-Path $env:TEMP "firefox-esr-setup.exe"
    $url = "https://download.mozilla.org/?product=firefox-esr-latest-ssl&os=win64&lang=en-US"
    Get-RemoteFile -Url $url -Dest $tmp -StartPct 10 -EndPct 55 -Status "Fetching Firefox ESR..." -Detail "Официальный ESR, не поверх повседневного Firefox"
    Write-SsbProgress 58 "Extracting ESR..." "Распаковываю ESR в $Runtime"
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

try {
    if ($Uninstall) { Uninstall-Private; return }

    $source = $null
    $install = $null
    Write-SsbProgress 4 "Starting..." "Готовлю частную папку $AppRoot"
    if ($FetchEsr) {
        $install = Install-EsrRuntime
    } else {
        Write-SsbProgress 12 "Finding Firefox..." "Ищу установленный Firefox (Program Files не патчим)"
        $source = Get-FirefoxSource
        $install = Copy-Runtime $source
    }

    Write-SsbProgress 72 "Fetching Grok sidecar..." "Собираю companion $ProductVersion"
    Pack-Xpi
    Write-SsbProgress 82 "Private profile..." "Пишу overlay и профиль только в $AppRoot"
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

    Write-SsbProgress 96 "Shortcuts..." "Ярлыки готовы"
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
    Write-SsbDone $install.Channel
} catch {
    Write-SsbFail $_.Exception.Message
    throw
}
