#Requires -Version 5.1
# Primary auto-update path: GitHub Releases (public). Does not touch Program Files.
param([switch]$Force)

$ErrorActionPreference = "Stop"
$Product = "0.1.1"
$Repo = "shastitko1970-netizen/substudio-browser"
$AppRoot = Join-Path $env:LOCALAPPDATA "SubStudioBrowser"
$Current = $Product
if (Test-Path (Join-Path $AppRoot "VERSION")) {
    $Current = (Get-Content (Join-Path $AppRoot "VERSION") -Raw).Trim()
}

$rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ Accept = "application/vnd.github+json" }
$latest = $rel.tag_name.TrimStart("v")
if (-not $Force -and $latest -eq $Current) {
    Write-Host "Уже $Current"
    return
}

$zip = $rel.assets | Where-Object { $_.name -like "SubStudioBrowser-*.zip" } | Select-Object -First 1
if (-not $zip) { throw "В релизе нет SubStudioBrowser-*.zip" }

$tmp = Join-Path $env:TEMP $zip.name
Write-Host "Качаю $($zip.browser_download_url)"
Invoke-WebRequest -Uri $zip.browser_download_url -OutFile $tmp

$shaAsset = $rel.assets | Where-Object { $_.name -like "*.sha256" } | Select-Object -First 1
if ($shaAsset) {
    $expected = ((Invoke-WebRequest -Uri $shaAsset.browser_download_url).Content.ToString().Split()[0]).ToLower()
    $actual = (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower()
    if ($expected -ne $actual) {
        throw "SHA256 mismatch: expected $expected got $actual"
    }
}

$extract = Join-Path $env:TEMP "ssb-update"
if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
Expand-Archive $tmp $extract -Force
$root = Get-ChildItem $extract -Directory | Select-Object -First 1
if (-not $root) { $root = Get-Item $extract }

$setup = Get-ChildItem $root.FullName -Filter Install-SubStudioBrowser.ps1 -Recurse | Select-Object -First 1
if (-not $setup) { throw "В архиве нет установщика" }
& $setup.FullName

Write-Host "Обновлено до $latest. Перезапустите ярлык SubStudio Browser."
