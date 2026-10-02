# Starnet Office installer for Windows (Paperclip + Starnet packs), no WSL.
#
# One line in PowerShell:
#   irm https://raw.githubusercontent.com/sigitholic/paperclip/starnet/main/packages/starnet-installer/install.ps1 | iex
# Or double-click packages\starnet-installer\install.cmd inside a clone.
#
# Safe to run again: every step checks first and skips what is already done, so re-running it is
# also how you update (git pull + install + build). Windows PowerShell 5.1 compatible, ASCII-only.
param(
  [string]$InstallDir = $env:STARNET_DIR,
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$RepoUrl = "https://github.com/sigitholic/paperclip.git"
$Branch = "starnet/main"

function Write-Boot([string]$Text) { Write-Host ""; Write-Host "==> $Text" -ForegroundColor Cyan }

function Refresh-BootPath {
  $env:Path = ([Environment]::GetEnvironmentVariable("Path", "Machine"), [Environment]::GetEnvironmentVariable("Path", "User") | Where-Object { $_ }) -join ";"
}

function Install-WingetPackage([string]$Id, [string]$Label, [string[]]$Extra = @()) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget tidak ada. Install 'App Installer' dari Microsoft Store, lalu jalankan installer lagi."
  }
  Write-Host "    ..  Menginstall $Label (winget $Id). Klik 'Yes' kalau Windows meminta izin." -ForegroundColor Gray
  $ErrorActionPreference = "Continue"
  & winget install --id $Id -e --source winget --accept-source-agreements --accept-package-agreements @Extra
  Refresh-BootPath
}

function Resolve-RepoDir {
  if ($InstallDir) { return [IO.Path]::GetFullPath($InstallDir) }
  if ($PSScriptRoot) {
    $candidate = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
    if (Test-Path (Join-Path $candidate ".git")) { return $candidate }
  }
  return (Join-Path $HOME "starnet-paperclip")
}

$WindowsPatchFile = "server\src\services\plugin-loader.ts"

function Sync-Repo([string]$Dir) {
  $ErrorActionPreference = "Continue"
  if (-not (Test-Path (Join-Path $Dir ".git"))) {
    # Shallow: the full upstream history is large and not needed to run or update (git pull works).
    Write-Host "    ..  Clone $RepoUrl ($Branch) ke $Dir" -ForegroundColor Gray
    & git clone --depth 1 --branch $Branch $RepoUrl $Dir
    if ($LASTEXITCODE -ne 0) { throw "git clone gagal. Cek koneksi internet." }
    return
  }
  # The local Windows patch (see Set-WindowsPluginLoaderPatch) is re-applied after the update.
  & git -C $Dir checkout -- $WindowsPatchFile 2>$null
  $dirty = & git -C $Dir status --porcelain --untracked-files=no
  if ($dirty) {
    Write-Host "    !!  Ada perubahan lokal di repo, update (git pull) dilewati:" -ForegroundColor Yellow
    $dirty | ForEach-Object { Write-Host "        $_" -ForegroundColor Yellow }
    return
  }
  & git -C $Dir pull --ff-only
  if ($LASTEXITCODE -ne 0) { Write-Host "    !!  git pull gagal; lanjut dengan versi yang ada." -ForegroundColor Yellow }
}

# --- 1. Git + source --------------------------------------------------------------------------
Write-Boot "Starnet Office installer"
Refresh-BootPath
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Install-WingetPackage "Git.Git" "Git for Windows" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git belum terbaca. Tutup jendela ini, buka PowerShell baru, lalu jalankan installer lagi." }

$RepoDir = Resolve-RepoDir
Write-Boot "Kode Starnet di $RepoDir"
Sync-Repo $RepoDir
. (Join-Path $RepoDir "packages\starnet-installer\lib.ps1")
New-Item -ItemType Directory -Force -Path $StarnetHome, $StarnetBin | Out-Null

# --- 2. Prerequisites ---------------------------------------------------------------------------
Write-Step "Cek ruang disk"
$systemDrive = Get-PSDrive -Name ($env:SystemDrive.TrimEnd(":"))
$freeGb = [math]::Round($systemDrive.Free / 1GB, 1)
if ($freeGb -lt 15) { Write-Warn "Sisa ruang di $($env:SystemDrive) hanya $freeGb GB. Butuh sekitar 15 GB (Build Tools, Docker, Rust). Kosongkan ruang dulu kalau install gagal." }
else { Write-Ok "$freeGb GB kosong di $($env:SystemDrive)" }

function Get-NodeVersion {
  if (-not (Test-Command node)) { return $null }
  $raw = (& node -v) -replace "^v", ""
  try { return [version]$raw } catch { return $null }
}

Write-Step "Node.js 24+"
$node = Get-NodeVersion
if (-not $node -or $node -lt [version]"24.11.0") {
  Install-WingetPackage "OpenJS.NodeJS.LTS" "Node.js LTS"
  Update-SessionPath
  $node = Get-NodeVersion
}
if (-not $node -or $node -lt [version]"24.11.0") { Stop-Starnet "Butuh Node.js 24.11 atau lebih baru (terbaca: $node). Install manual dari https://nodejs.org lalu jalankan installer lagi." }
Write-Ok "Node $node"

Write-Step "Visual Studio Build Tools (compiler C++ untuk Rust)"
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
function Test-VcTools {
  if (-not (Test-Path $vswhere)) { return $false }
  $path = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  return [bool]$path
}
if (-not (Test-VcTools)) {
  Write-Note "Ukurannya besar (sekitar 5 GB) dan bisa 10-30 menit."
  Install-WingetPackage "Microsoft.VisualStudio.2022.BuildTools" "Visual Studio Build Tools" @("--override", "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended")
}
if (-not (Test-VcTools)) { Stop-Starnet "Build Tools C++ belum terpasang. Install 'Desktop development with C++' dari Visual Studio Installer, lalu jalankan installer lagi." }
Write-Ok "Build Tools C++ terpasang"

Write-Step "Rust"
Update-SessionPath
if (-not (Test-Command cargo)) {
  Install-WingetPackage "Rustlang.Rustup" "Rust (rustup)"
  Update-SessionPath
}
if (Test-Command rustup) {
  $ErrorActionPreference = "Continue"
  & rustc --version *> $null
  if ($LASTEXITCODE -ne 0) { & rustup default stable }
  $ErrorActionPreference = "Stop"
}
if (-not (Test-Command cargo)) { Stop-Starnet "cargo belum terbaca. Buka PowerShell baru lalu jalankan installer lagi." }
Write-Ok ((& cargo --version) -join "")

Write-Step "Docker Desktop"
$dockerExe = Get-DockerDesktopExe
if (-not (Test-Path $dockerExe)) {
  Install-WingetPackage "Docker.DockerDesktop" "Docker Desktop"
  if (Test-Path $dockerExe) {
    Write-Warn "Docker Desktop baru terpasang. Restart Windows, buka Docker Desktop sekali (terima syarat penggunaannya), lalu jalankan installer ini lagi."
    return
  }
  Stop-Starnet "Docker Desktop gagal terpasang. Install manual dari https://www.docker.com/products/docker-desktop/ lalu jalankan installer lagi."
}
try {
  Start-DockerEngine
} catch {
  Write-Warn "Kalau Docker baru saja diinstall: restart Windows, buka Docker Desktop sekali, lalu jalankan installer lagi."
  throw
}

# --- 3. Database --------------------------------------------------------------------------------
Write-Step "Database Postgres (Docker)"
Start-StarnetPostgres

# --- 4. Dependencies and build ------------------------------------------------------------------
Write-Step "pnpm (lewat Corepack)"
Use-StarnetShell
$ErrorActionPreference = "Continue"
& corepack enable --install-directory $StarnetBin
$ErrorActionPreference = "Stop"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not (($userPath -split ";") -contains $StarnetBin)) {
  [Environment]::SetEnvironmentVariable("Path", (@($StarnetBin, $userPath) | Where-Object { $_ }) -join ";", "User")
}
Update-SessionPath
Push-Location $RepoDir
try {
  $pnpmVersion = (& pnpm -v) -join ""
  if ($LASTEXITCODE -ne 0) { Stop-Starnet "pnpm tidak bisa dijalankan lewat Corepack." }
  Write-Ok "pnpm $pnpmVersion (shell script: Git Bash)"

  Write-Step "Install dependency (pnpm install, beberapa menit)"
  & pnpm install
  if ($LASTEXITCODE -ne 0) { Stop-Starnet "pnpm install gagal. Lihat pesan di atas." }
  Write-Ok "Dependency terpasang"

  Write-Step "Tambalan lokal Windows untuk plugin"
  # Upstream forks repo-local plugin workers with a raw absolute --import path that Node rejects on
  # Windows ("Received protocol 'e:'"). Applied locally only, never committed (STARNET_PATCHES.md #7).
  $patchPath = Join-Path $RepoDir $WindowsPatchFile
  $source = [IO.File]::ReadAllText($patchPath)
  $before = 'workerOptions.execArgv = ["--import", DEV_TSX_LOADER_PATH];'
  $after = 'workerOptions.execArgv = ["--import", pathToFileURL(DEV_TSX_LOADER_PATH).href];'
  if ($source.Contains($after)) { Write-Ok "Sudah terpasang" }
  elseif ($source.Contains($before)) {
    [IO.File]::WriteAllText($patchPath, $source.Replace($before, $after), (New-Object Text.UTF8Encoding $false))
    Write-Ok "Dipasang di $WindowsPatchFile (perubahan lokal, jangan di-commit)"
  } else { Write-Warn "Baris yang ditambal tidak ditemukan; mungkin sudah diperbaiki upstream. Dilewati." }

  Write-Step "Build plugin Starnet"
  & pnpm --filter "./packages/plugins/starnet-*" build
  if ($LASTEXITCODE -ne 0) { Stop-Starnet "Build plugin Starnet gagal." }
  Write-Ok "Plugin Starnet ter-build"

  # --- 5. First-run setup -----------------------------------------------------------------------
  Write-Step "Setup awal Paperclip (onboard)"
  if (Test-Onboarded) {
    Write-Ok "Sudah pernah di-setup ($InstanceDir)"
  } else {
    # onboard --yes saves the config and secrets, then starts the server; stop it once the files exist.
    $log = Join-Path $StarnetHome "onboard.log"
    $env:DATABASE_URL = $DatabaseUrl
    $env:PAPERCLIP_NO_BROWSER = "1"
    $proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/d", "/c", "pnpm paperclipai onboard --yes --no-install-service > `"$log`" 2>&1" -WorkingDirectory $RepoDir -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).AddMinutes(10)
    while (-not (Test-Onboarded) -and -not $proc.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
    Start-Sleep -Seconds 3
    if (-not $proc.HasExited) { Stop-ProcessTree $proc.Id }
    Remove-Item Env:DATABASE_URL, Env:PAPERCLIP_NO_BROWSER -ErrorAction SilentlyContinue
    if (-not (Test-Onboarded)) { Stop-Starnet "Onboard tidak selesai. Lihat log: $log" }
    Write-Ok "Config dan secret instance dibuat di $InstanceDir"
  }
} finally {
  Pop-Location
}

# --- 6. Shortcut --------------------------------------------------------------------------------
Write-Step "Shortcut desktop"
$startCmd = Join-Path $RepoDir "packages\starnet-installer\start.cmd"
$shortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Starnet Office.lnk"
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = $startCmd
$link.WorkingDirectory = $RepoDir
$link.Description = "Nyalakan Starnet Office (Paperclip)"
$link.Save()
Write-Ok "Dibuat: $shortcut"

Write-Host ""
Write-Host "Instalasi selesai." -ForegroundColor Green
Write-Host "Menyalakan Starnet: dobel-klik 'Starnet Office' di desktop (atau jalankan $startCmd)."
Write-Host "Start pertama butuh 5-10 menit (compile Rust + build). Browser terbuka otomatis saat siap."
if (-not $NoStart) {
  $answer = Read-Host "Nyalakan sekarang? (Y/n)"
  if ($answer -notmatch "^[nN]") { & (Join-Path $RepoDir "packages\starnet-installer\start.ps1") }
}
