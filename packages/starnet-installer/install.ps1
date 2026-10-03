# Starnet Office installer for Windows - light edition: no Git, Docker, Rust, Build Tools or WSL.
#
# One line in a normal PowerShell window (not "Run as administrator"):
#   irm https://raw.githubusercontent.com/sigitholic/paperclip/starnet/main/packages/starnet-installer/install.ps1 | iex
#
# Installs into %LOCALAPPDATA%\StarnetOffice:
#   node\   portable Node.js 24 (official zip, SHA-256 checked)
#   app\    the published `paperclipai` npm package (prebuilt, embedded Postgres) + app\starnet\ (prebuilt Starnet
#           plugins and starnet_9router adapter from the `starnet-bundle` GitHub Release)
#   data\   Paperclip data (separate from ~/.paperclip, so an older source install is left alone)
# Safe to run again; that is also how you update. Building from source (developers): install-dev.ps1.
# Windows PowerShell 5.1 compatible, ASCII-only.
param(
  [string]$Root = $env:STARNET_HOME,
  [string]$BundleZip = $env:STARNET_BUNDLE_ZIP,
  [switch]$NoStart = ($env:STARNET_NO_START -eq "1")
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force -ErrorAction Stop } catch { }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo = "sigitholic/paperclip"
$RawBase = "https://raw.githubusercontent.com/$Repo/starnet/main/packages/starnet-installer"
$BundleUrl = "https://github.com/$Repo/releases/download/starnet-bundle/starnet-bundle.zip"
$MinNode = [version]"24.11.0"
$Port = if ($env:STARNET_PORT) { [int]$env:STARNET_PORT } else { 3100 }
$PgPort = 54331

if (-not $Root) { $Root = Join-Path $env:LOCALAPPDATA "StarnetOffice" }
$Root = [IO.Path]::GetFullPath($Root)
$NodeDir = Join-Path $Root "node"
$NodeExe = Join-Path $NodeDir "node.exe"
$NpmCli = Join-Path $NodeDir "node_modules\npm\bin\npm-cli.js"
$AppDir = Join-Path $Root "app"
$BundleDir = Join-Path $AppDir "starnet"
$SettingsFile = Join-Path $Root "settings.json"
$TempDir = Join-Path $Root "tmp"

function Write-Step([string]$Text) { Write-Host ""; Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    OK  $Text" -ForegroundColor Green }
function Write-Note([string]$Text) { Write-Host "    ..  $Text" -ForegroundColor Gray }
function Write-Warn([string]$Text) { Write-Host "    !!  $Text" -ForegroundColor Yellow }
function Stop-Starnet([string]$Text) { Write-Host ""; Write-Host "GAGAL: $Text" -ForegroundColor Red; throw $Text }

function Test-Elevated {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-UacEnabled {
  try {
    $lua = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" -Name EnableLUA -ErrorAction Stop).EnableLUA
    return $lua -ne 0
  } catch { return $true }
}

function Read-Settings {
  if (Test-Path $SettingsFile) { return Get-Content -Raw $SettingsFile | ConvertFrom-Json }
  return $null
}

function Test-StarnetRunning {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "http://127.0.0.1:$Port/api/health" | Out-Null; return $true } catch { return $false }
}

function Save-Download([string]$Url, [string]$OutFile) {
  Write-Note "Download $Url"
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile
}

function Expand-Zip([string]$Zip, [string]$Dest) {
  if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  $tar = Join-Path $env:SystemRoot "System32\tar.exe"
  if (Test-Path $tar) {
    & $tar -xf $Zip -C $Dest
    if ($LASTEXITCODE -eq 0) { return }
  }
  Expand-Archive -Path $Zip -DestinationPath $Dest -Force
}

function Get-PortableNodeVersion {
  if (-not (Test-Path $NodeExe)) { return $null }
  try { return [version]((& $NodeExe -v) -replace "^v", "") } catch { return $null }
}

function Invoke-Npm([string[]]$NpmArgs) {
  $env:Path = "$NodeDir;$env:Path"
  $ErrorActionPreference = "Continue"
  & $NodeExe $NpmCli @NpmArgs | Out-Host
  $code = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  return $code
}

# --- 1. Checks -----------------------------------------------------------------------------------
Write-Step "Starnet Office installer (ringan)"
Write-Note "Folder install: $Root"
New-Item -ItemType Directory -Force -Path $Root, $TempDir | Out-Null

$settings = Read-Settings
$databaseUrl = if ($settings -and $settings.databaseUrl) { [string]$settings.databaseUrl } else { "" }

Write-Step "Mode database"
if ($databaseUrl) {
  Write-Ok "Postgres di Docker (dipilih saat install sebelumnya)"
} elseif (Test-Elevated) {
  # Postgres refuses to start with an administrator token, so the embedded database cannot run elevated.
  if (Test-UacEnabled) {
    Stop-Starnet "Installer dijalankan sebagai Administrator. Tutup jendela ini, buka PowerShell biasa (jangan 'Run as administrator'), lalu tempel baris install lagi."
  }
  Write-Warn "UAC Windows mati, jadi semua program berjalan sebagai Administrator dan database bawaan tidak bisa jalan."
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Stop-Starnet "Nyalakan UAC (Control Panel > User Accounts > Change User Account Control settings, geser ke level default, restart), atau install Docker Desktop, lalu jalankan installer lagi."
  }
  $databaseUrl = "postgres://paperclip:paperclip@127.0.0.1:$PgPort/paperclip"
  Write-Ok "Memakai Postgres di Docker (container starnet-office-pg, port $PgPort)"
} else {
  Write-Ok "Database bawaan (embedded Postgres), tanpa Docker"
}

$drive = Get-PSDrive -Name ($Root.Substring(0, 1))
$freeGb = [math]::Round($drive.Free / 1GB, 1)
if ($freeGb -lt 4) { Write-Warn "Sisa ruang di drive $($drive.Name): hanya $freeGb GB. Butuh sekitar 4 GB." }

if (Test-StarnetRunning) {
  Stop-Starnet "Starnet Office (atau Paperclip lain di port $Port) sedang jalan. Tutup jendelanya dulu, lalu jalankan installer lagi."
}

# --- 2. Portable Node.js -------------------------------------------------------------------------
Write-Step "Node.js 24 (portable, khusus Starnet)"
$node = Get-PortableNodeVersion
if ($node -and $node -ge $MinNode) {
  Write-Ok "Node $node"
} else {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "win-arm64" } else { "win-x64" }
  $distBase = "https://nodejs.org/dist/latest-v24.x"
  $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$distBase/SHASUMS256.txt").Content
  $match = [regex]::Match($sums, "(?m)^([0-9a-f]{64})\s+(node-v[\d.]+-$arch\.zip)\s*$")
  if (-not $match.Success) { Stop-Starnet "Tidak menemukan Node.js 24 untuk $arch di $distBase." }
  $zip = Join-Path $TempDir $match.Groups[2].Value
  Save-Download "$distBase/$($match.Groups[2].Value)" $zip
  if ((Get-FileHash -Algorithm SHA256 $zip).Hash -ne $match.Groups[1].Value.ToUpper()) { Stop-Starnet "Checksum Node.js tidak cocok. Coba lagi." }
  $extract = Join-Path $TempDir "node"
  Expand-Zip $zip $extract
  $inner = Get-ChildItem -Directory $extract | Select-Object -First 1
  if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
  Move-Item $inner.FullName $NodeDir
  Remove-Item -Force $zip
  $node = Get-PortableNodeVersion
  if (-not $node) { Stop-Starnet "Node.js portable gagal dipasang di $NodeDir." }
  Write-Ok "Node $node"
}

# --- 3. Starnet bundle ---------------------------------------------------------------------------
Write-Step "Paket Starnet (plugin + adapter, sudah jadi)"
if ($BundleZip) {
  $zip = [IO.Path]::GetFullPath($BundleZip)
  Write-Note "Dari file lokal $zip"
} else {
  $zip = Join-Path $TempDir "starnet-bundle.zip"
  Save-Download $BundleUrl $zip
}
$newBundle = Join-Path $TempDir "starnet-bundle"
Expand-Zip $zip $newBundle
$bundleInfoPath = Join-Path $newBundle "bundle.json"
if (-not (Test-Path $bundleInfoPath)) { Stop-Starnet "Paket Starnet rusak (bundle.json tidak ada)." }
$bundle = Get-Content -Raw $bundleInfoPath | ConvertFrom-Json
Write-Ok "Paket $($bundle.commit): $(@($bundle.plugins).Count) plugin + adapter $($bundle.adapter.type), untuk paperclipai $($bundle.paperclipVersion)"

# --- 4. Paperclip (npm, prebuilt) ----------------------------------------------------------------
Write-Step "Paperclip $($bundle.paperclipVersion) (paket npm, tanpa compile)"
$installedPkg = Join-Path $AppDir "node_modules\paperclipai\package.json"
$installed = if (Test-Path $installedPkg) { (Get-Content -Raw $installedPkg | ConvertFrom-Json).version } else { $null }
if ($installed -eq $bundle.paperclipVersion) {
  Write-Ok "Sudah terpasang"
} else {
  Write-Note "Beberapa menit, tergantung internet (sekitar 400 paket)."
  New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
  $code = Invoke-Npm @("install", "--prefix", $AppDir, "paperclipai@$($bundle.paperclipVersion)", "--no-audit", "--no-fund", "--loglevel=error")
  if ($code -ne 0) { Stop-Starnet "npm install paperclipai gagal. Cek koneksi internet lalu jalankan installer lagi." }
  Write-Ok "Terpasang di $AppDir"
}

# The adapter resolves @paperclipai/* and @openai/codex from app\node_modules, so it lives under app\.
if (Test-Path $BundleDir) { Remove-Item -Recurse -Force $BundleDir }
Move-Item $newBundle $BundleDir
Write-Ok "Paket Starnet di $BundleDir"

# --- 5. Launcher + shortcut ----------------------------------------------------------------------
Write-Step "Launcher dan shortcut desktop"
$settingsOut = [ordered]@{
  port = $Port
  databaseUrl = $databaseUrl
  paperclipVersion = $bundle.paperclipVersion
  bundleCommit = $bundle.commit
  installedAt = (Get-Date).ToString("s")
}
[IO.File]::WriteAllText($SettingsFile, ($settingsOut | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

foreach ($file in @("start.ps1", "fix-agents.mjs")) {
  $target = Join-Path $Root $file
  $local = if ($PSScriptRoot) { Join-Path $PSScriptRoot $file } else { $null }
  if ($local -and (Test-Path $local)) { Copy-Item -Force $local $target }
  else { Save-Download "$RawBase/$file" $target }
}
$startCmd = Join-Path $Root "start.cmd"
$cmdText = "@echo off`r`ntitle Starnet Office`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0start.ps1`" %*`r`necho.`r`npause`r`n"
[IO.File]::WriteAllText($startCmd, $cmdText, (New-Object Text.ASCIIEncoding))
$fixCmd = Join-Path $Root "fix-agents.cmd"
$fixText = "@echo off`r`ntitle Starnet Office - Perbaiki Agent`r`n`"%~dp0node\node.exe`" `"%~dp0fix-agents.mjs`"`r`necho.`r`npause`r`n"
[IO.File]::WriteAllText($fixCmd, $fixText, (New-Object Text.ASCIIEncoding))

$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell
foreach ($entry in @(
    @{ Name = "Starnet Office"; Target = $startCmd; Description = "Nyalakan Starnet Office (Paperclip)" },
    @{ Name = "Starnet - Perbaiki Agent"; Target = $fixCmd; Description = "Lepas ikatan AI connection agent sebelum ganti adapter" }
  )) {
  $link = $shell.CreateShortcut((Join-Path $desktop "$($entry.Name).lnk"))
  $link.TargetPath = $entry.Target
  $link.WorkingDirectory = $Root
  $link.Description = $entry.Description
  $link.Save()
  Write-Ok "Shortcut: $($entry.Name)"
}
Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Instalasi selesai." -ForegroundColor Green
Write-Host "Menyalakan Starnet: dobel-klik 'Starnet Office' di desktop."
Write-Host "Start pertama menyiapkan database (sekitar 3-5 menit). Browser terbuka otomatis saat siap."
if (-not $NoStart) {
  $answer = Read-Host "Nyalakan sekarang? (Y/n)"
  if ($answer -notmatch "^[nN]") { Start-Process -FilePath $startCmd -WorkingDirectory $Root }
}
