# Starts Starnet Office on Windows: Docker Desktop, the Postgres container, then `pnpm dev` in this
# window. Once the API answers it seeds the Starnet Demo company (idempotent) and opens the browser.
# Close the window or press Ctrl+C to stop. Windows PowerShell 5.1 compatible, ASCII-only.
param(
  [switch]$NoSeed,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$RepoDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
. (Join-Path $PSScriptRoot "lib.ps1")

Write-Step "Starnet Office"
Start-DockerEngine
Start-StarnetPostgres
Repair-StarnetDatabaseLogin

if (Test-PaperclipHealth) {
  Write-Ok "Starnet sudah jalan di $PaperclipUrl"
  if (-not $NoBrowser) { Start-Process $PaperclipUrl }
  return
}
if (-not (Test-Onboarded)) { Stop-Starnet "Starnet belum di-setup. Jalankan packages\starnet-installer\install.cmd dulu." }
Sync-InstanceDatabaseUrl

Use-StarnetShell
$env:PAPERCLIP_OPEN_ON_LISTEN = "false"
New-Item -ItemType Directory -Force -Path $StarnetHome | Out-Null
$seedLog = Join-Path $StarnetHome "seed.log"

$waiter = Start-Job -ArgumentList $RepoDir, $PaperclipUrl, ([bool]$NoSeed), ([bool]$NoBrowser), $seedLog -ScriptBlock {
  param($repo, $url, $noSeed, $noBrowser, $log)
  $deadline = (Get-Date).AddMinutes(30)
  $up = $false
  while (-not $up -and (Get-Date) -lt $deadline) {
    try { $up = (Invoke-WebRequest -Uri "$url/api/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { Start-Sleep -Seconds 5 }
  }
  if (-not $up) { return }
  if (-not $noSeed) {
    Set-Location $repo
    $ErrorActionPreference = "Continue"
    & node packages/starnet-devkit/scripts/demo-seed.mjs *> $log
  }
  if (-not $noBrowser) { Start-Process $url }
}

Write-Note "Menyalakan server (start pertama 5-10 menit: compile Rust + build)."
Write-Note "Browser terbuka otomatis setelah siap. Tutup jendela ini atau tekan Ctrl+C untuk mematikan."
Write-Note "Log seed demo: $seedLog"
Push-Location $RepoDir
try {
  & pnpm dev
} finally {
  Pop-Location
  Remove-Job -Job $waiter -Force -ErrorAction SilentlyContinue
}
