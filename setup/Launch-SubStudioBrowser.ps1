#Requires -Version 5.1
# SPDX-License-Identifier: MIT
# Starts the private Firefox copy. Optional -CheckUpdate queries GitHub Releases.
param([switch]$CheckUpdate)

$ErrorActionPreference = "Stop"
$AppRoot = Join-Path $env:LOCALAPPDATA "SubStudioBrowser"
$RuntimeExe = Join-Path $AppRoot "runtime\firefox.exe"
$ProfileDir = Join-Path $AppRoot "profile"
$Repo = "shastitko1970-netizen/substudio-browser"

if (-not (Test-Path $RuntimeExe)) {
    $setup = Join-Path $PSScriptRoot "Install-SubStudioBrowser.ps1"
    if (Test-Path $setup) {
        & $setup
    } else {
        throw "Сначала запустите Install-SubStudioBrowser.ps1"
    }
}

if ($CheckUpdate) {
    try {
        $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ Accept = "application/vnd.github+json" }
        $latest = $rel.tag_name.TrimStart("v")
        $current = "0.1.1"
        if (Test-Path (Join-Path $AppRoot "VERSION")) {
            $current = (Get-Content (Join-Path $AppRoot "VERSION") -Raw).Trim()
        }
        if ($latest -and $latest -ne $current) {
            Write-Host "Доступно $latest (сейчас $current). Запустите Update-SubStudioBrowser.ps1"
        }
    } catch {
        Write-Verbose $_.Exception.Message
    }
}

Start-Process -FilePath $RuntimeExe -ArgumentList @("-profile", $ProfileDir, "-no-remote")
