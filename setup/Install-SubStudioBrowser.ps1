#Requires -Version 5.1
<#
.SYNOPSIS
  Install SubStudio Browser 0.1.3 into a PRIVATE Firefox copy.

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
    [string]$ProgressLog,
    [string]$SetupLog
)

$ErrorActionPreference = "Stop"
$ProductVersion = "0.1.3"
$AppRoot = Join-Path $env:LOCALAPPDATA "SubStudioBrowser"
if (-not $SetupLog) {
    $SetupLog = Join-Path $AppRoot "setup.log"
}
$Runtime = Join-Path $AppRoot "runtime"
$ProfileDir = Join-Path $AppRoot "profile"
$OverlayDir = Join-Path $AppRoot "overlay"
$XpiDir = Join-Path $AppRoot "extensions"
$XpiPath = Join-Path $XpiDir "substudio-companion.xpi"
$StateFile = Join-Path $AppRoot "setup-state.json"
$CompanionId = "substudio-companion@substudio.browser"
$VersionFile = Join-Path $AppRoot "VERSION"

function Write-SsbLog([string]$Message) {
    $line = "$(Get-Date -Format o) $Message"
    Write-Host $line
    $dir = Split-Path -Parent $SetupLog
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    Add-Content -LiteralPath $SetupLog -Value $line -Encoding UTF8
}

function Resolve-SsbRepoRoot {
    $cursor = $PSScriptRoot
    while ($cursor) {
        $cfg = Join-Path $cursor "mozilla.cfg"
        $dist = Join-Path $cursor "distribution\policies.json"
        $ext = Join-Path $cursor "extension\manifest.json"
        if ((Test-Path -LiteralPath $cfg) -and (Test-Path -LiteralPath $dist) -and (Test-Path -LiteralPath $ext)) {
            return $cursor
        }
        $parent = Split-Path -Parent $cursor
        if (-not $parent -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
    throw "overlay incomplete: mozilla.cfg / distribution / extension not found above $PSScriptRoot"
}

function Write-Step([string]$Message) { Write-SsbLog "==> $Message" }

function Write-SsbProgressLine([string]$Path, [string]$Line) {
    if (-not $Path) { return }
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, $share)
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes(($Line.TrimEnd() + [Environment]::NewLine))
        $stream.Write($bytes, 0, $bytes.Length)
    } finally {
        $stream.Dispose()
    }
}

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
        Write-SsbProgressLine $ProgressLog $payload
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
        Write-SsbProgressLine $ProgressLog $payload
    }
}

function Write-SsbFail([string]$Message) {
    Write-SsbLog "FAIL $Message"
    $payload = @{
        percent = 0
        status  = "Failed"
        detail  = $Message
        phase   = "error"
    } | ConvertTo-Json -Compress
    Write-Host "##SSB##$payload"
    if ($ProgressLog) {
        Write-SsbProgressLine $ProgressLog $payload
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
        Write-SsbLog "GET $Url -> $($response.ResponseUri) ($($response.ContentLength) bytes)"
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

function Assert-FullPayload([string]$Path) {
    $item = Get-Item -LiteralPath $Path
    if ($item.Length -lt 20MB) {
        throw "Downloaded $($item.Length) bytes — this is the stub installer, not the full ESR payload."
    }
}

function Find-SsbFirefoxExe([string]$Root) {
    if (-not (Test-Path -LiteralPath $Root)) { return $null }
    $direct = Join-Path $Root "firefox.exe"
    if (Test-Path -LiteralPath $direct) { return $direct }
    $core = Join-Path $Root "core\firefox.exe"
    if (Test-Path -LiteralPath $core) { return $core }
    $hit = Get-ChildItem -LiteralPath $Root -Filter firefox.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hit) { return $hit.FullName }
    return $null
}

function Copy-SsbRuntimeTree([string]$ExePath) {
    $src = Split-Path -Parent $ExePath
    if (Test-Path -LiteralPath $Runtime) { Remove-Item -LiteralPath $Runtime -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
    Copy-Item -Path (Join-Path $src "*") -Destination $Runtime -Recurse -Force
    $exe = Join-Path $Runtime "firefox.exe"
    if (-not (Test-Path -LiteralPath $exe)) {
        throw "firefox.exe missing after copy from $src"
    }
    return $exe
}

function Expand-SsbSfx([string]$Exe, [string]$Dest) {
    if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $Dest | Out-Null
    $candidates = @(
        "7z.exe",
        "7za.exe",
        (Join-Path $env:ProgramFiles "7-Zip\7z.exe")
    )
    if (${env:ProgramFiles(x86)}) {
        $candidates += (Join-Path ${env:ProgramFiles(x86)} "7-Zip\7z.exe")
    }
    foreach ($bin in $candidates) {
        $use = $null
        if (Test-Path -LiteralPath $bin) {
            $use = $bin
        } else {
            $cmd = Get-Command $bin -ErrorAction SilentlyContinue
            if ($cmd) { $use = $cmd.Source }
        }
        if (-not $use) { continue }
        Write-SsbLog "7z extract $use -> $Dest"
        $proc = Start-Process -FilePath $use -ArgumentList @("x", "-y", "-o$Dest", $Exe) -Wait -PassThru -WindowStyle Hidden
        Write-SsbLog "7z exit $($proc.ExitCode)"
        $found = Find-SsbFirefoxExe $Dest
        if ($found) { return $found }
    }
    return $null
}

function Install-EsrSilent([string]$Exe) {
    if (Test-Path -LiteralPath $Runtime) { Remove-Item -LiteralPath $Runtime -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
    $silentArgs = @(
        "/S",
        "/InstallDirectoryPath=$Runtime",
        "/DesktopShortcut=false",
        "/StartMenuShortcut=false",
        "/TaskbarShortcut=false",
        "/MaintenanceService=false"
    )
    Write-SsbLog "silent install $Exe $($silentArgs -join ' ')"
    $proc = Start-Process -FilePath $Exe -ArgumentList $silentArgs -Wait -PassThru -WindowStyle Hidden
    Write-SsbLog "silent install exit $($proc.ExitCode)"
    return (Find-SsbFirefoxExe $Runtime)
}

function Install-EsrRuntime {
    Write-SsbProgress 8 "Fetching Firefox ESR..." "Скачиваю официальный Firefox ESR (unsigned XPI работает на ESR)"
    # Verified 2026-09-01: product=firefox-esr-latest-ssl&os=win64 follows redirects to the
    # full ~70MB 7z SFX (not the stub). 7z x leaves core\firefox.exe. The matching .msi is
    # only Binary.WrappedExe of the same SFX — msiexec /a does not produce firefox.exe.
    $tmp = Join-Path $env:TEMP "ssb-esr-$ProductVersion"
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $exe = Join-Path $tmp "firefox-esr-setup.exe"
    $stage = Join-Path $tmp "extract"
    $exeUrl = "https://download.mozilla.org/?product=firefox-esr-latest-ssl&os=win64&lang=en-US"
    Get-RemoteFile -Url $exeUrl -Dest $exe -StartPct 10 -EndPct 55 -Status "Fetching Firefox ESR..." -Detail "Full ESR win64 installer (not the stub)"
    Assert-FullPayload $exe

    Write-SsbProgress 58 "Extracting ESR..." "Распаковываю ESR в $Runtime (7z core\\firefox.exe, else silent InstallDirectoryPath)"
    $found = Expand-SsbSfx $exe $stage
    if (-not $found) {
        $found = Install-EsrSilent $exe
    }
    if (-not $found) {
        throw "Could not place firefox.exe under $Runtime. See $SetupLog"
    }
    Copy-SsbRuntimeTree $found | Out-Null
    $runtimeExe = Join-Path $Runtime "firefox.exe"
    if (-not (Test-Path -LiteralPath $runtimeExe)) {
        throw "ESR extract finished but $runtimeExe is missing"
    }
    Write-SsbLog "runtime firefox.exe ok ($((Get-Item -LiteralPath $runtimeExe).Length) bytes)"
    return [pscustomobject]@{ Exe = $runtimeExe; Root = $Runtime; Channel = "esr" }
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
    Copy-Item (Join-Path $RepoRoot "substudio-chrome.js") (Join-Path $Install.Root "substudio-chrome.js") -Force
    Copy-Item (Join-Path $RepoRoot "substudio-bridge.js") (Join-Path $Install.Root "substudio-bridge.js") -Force

    New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
    $userJs = @"
// SubStudio Browser $ProductVersion — dedicated profile only.
user_pref("network.proxy.socks_remote_dns", true);
user_pref("network.http.http3.enable", false);
user_pref("privacy.userContext.enabled", true);
user_pref("privacy.userContext.ui.enabled", true);
user_pref("sidebar.revamp", true);
user_pref("sidebar.verticalTabs", false);
user_pref("sidebar.visibility", "always-show");
user_pref("sidebar.position_start", true);
user_pref("browser.ml.chat.enabled", true);
user_pref("browser.ml.chat.provider", "https://grok.com");
user_pref("browser.ml.chat.hideLocalhost", false);
user_pref("browser.startup.homepage", "about:home");
user_pref("browser.startup.page", 1);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);
"@
    [IO.File]::WriteAllText((Join-Path $ProfileDir "user.js"), $userJs, $utf8)
    $chromeSrc = Join-Path $RepoRoot "chrome"
    $chromeDst = Join-Path $ProfileDir "chrome"
    New-Item -ItemType Directory -Force -Path $chromeDst | Out-Null
    Copy-Item (Join-Path $chromeSrc "userChrome.css") (Join-Path $chromeDst "userChrome.css") -Force
    Copy-Item (Join-Path $chromeSrc "userContent.css") (Join-Path $chromeDst "userContent.css") -Force
    $extDir = Join-Path $ProfileDir "extensions"
    New-Item -ItemType Directory -Force -Path $extDir | Out-Null
    Copy-Item $XpiPath (Join-Path $extDir "$CompanionId.xpi") -Force

    $brandDir = Join-Path $AppRoot "branding"
    New-Item -ItemType Directory -Force -Path $brandDir | Out-Null
    $srcIco = Join-Path $PSScriptRoot "substudio-browser.ico"
    $brandIco = Join-Path $brandDir "substudio-browser.ico"
    if (Test-Path $srcIco) {
        Copy-Item $srcIco $brandIco -Force
        Copy-Item $srcIco (Join-Path $chromeDst "substudio-browser.ico") -Force
    }
    $iconUri = ""
    if (Test-Path $brandIco) {
        $iconUri = ConvertTo-FileUri $brandIco
        $userJs += "`r`nuser_pref(`"identity.icon`", `"$iconUri`");`r`n"
        [IO.File]::WriteAllText((Join-Path $ProfileDir "user.js"), $userJs, $utf8)
    }

    $launcherSrc = Join-Path $PSScriptRoot "SubStudioBrowser.exe"
    $launcherDst = Join-Path $AppRoot "SubStudioBrowser.exe"
    if (Test-Path $launcherSrc) {
        Copy-Item $launcherSrc $launcherDst -Force
    }

    New-Item -ItemType Directory -Force -Path $OverlayDir | Out-Null
    Copy-Item (Join-Path $RepoRoot "VERSION") $VersionFile -Force
}

function New-Shortcut([string]$Path, $Install) {
    New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
    $wsh = New-Object -ComObject WScript.Shell
    $lnk = $wsh.CreateShortcut($Path)
    $branded = Join-Path $AppRoot "SubStudioBrowser.exe"
    $ps1 = Join-Path $PSScriptRoot "Launch-SubStudioBrowser.ps1"
    if (Test-Path $branded) {
        $lnk.TargetPath = $branded
        $lnk.Arguments = ""
        $lnk.WorkingDirectory = $AppRoot
    } else {
        $lnk.TargetPath = "powershell.exe"
        $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ps1`""
        $lnk.WorkingDirectory = $Install.Root
    }
    $lnk.Description = "SubStudio Browser $ProductVersion"
    $ico = Join-Path $AppRoot "branding\substudio-browser.ico"
    if (-not (Test-Path $ico)) { $ico = Join-Path $PSScriptRoot "substudio-browser.ico" }
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

    $script:RepoRoot = Resolve-SsbRepoRoot
    Write-SsbLog "RepoRoot=$script:RepoRoot PSScriptRoot=$PSScriptRoot"
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
    Write-SsbLog (($_ | Out-String).Trim())
    Write-SsbFail $_.Exception.Message
    throw
}
