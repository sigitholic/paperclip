# Starnet Office launcher for the light install (copied to %LOCALAPPDATA%\StarnetOffice by install.ps1).
# Starts Paperclip, installs any missing Starnet plugin / adapter from app\starnet through the local API,
# then opens the browser. Close this window (or Ctrl+C) to stop Starnet.
# Windows PowerShell 5.1 compatible, ASCII-only.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = $PSScriptRoot
$NodeDir = Join-Path $Root "node"
$NodeExe = Join-Path $NodeDir "node.exe"
$AppDir = Join-Path $Root "app"
$BundleDir = Join-Path $AppDir "starnet"
$DataDir = Join-Path $Root "data"
$Cli = Join-Path $AppDir "node_modules\paperclipai\dist\index.js"
$ConfigFile = Join-Path $DataDir "instances\default\config.json"
$PgContainer = "starnet-office-pg"
$PgVolume = "starnet-office-pgdata"

function Write-Step([string]$Text) { Write-Host ""; Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    OK  $Text" -ForegroundColor Green }
function Write-Note([string]$Text) { Write-Host "    ..  $Text" -ForegroundColor Gray }
function Write-Warn([string]$Text) { Write-Host "    !!  $Text" -ForegroundColor Yellow }
function Stop-Starnet([string]$Text) { Write-Host ""; Write-Host "GAGAL: $Text" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $Cli) -or -not (Test-Path $NodeExe)) {
  Stop-Starnet "Starnet belum terpasang lengkap di $Root. Jalankan installer lagi."
}
$settings = Get-Content -Raw (Join-Path $Root "settings.json") | ConvertFrom-Json
$Port = [int]$settings.port
$Base = "http://127.0.0.1:$Port"
$Api = "$Base/api"

function Test-Healthy {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "$Api/health" | Out-Null; return $true } catch { return $false }
}

function Invoke-DockerQuiet([string[]]$DockerArgs) {
  $ErrorActionPreference = "Continue"
  $out = & docker @DockerArgs 2>$null
  $code = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  return @{ Code = $code; Out = (($out | Out-String).Trim()) }
}

# Only used when the installer chose Docker (Windows with UAC off, where the embedded database cannot run).
function Start-OfficePostgres {
  Write-Step "Database Postgres (Docker)"
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Stop-Starnet "Docker tidak ditemukan. Install/buka Docker Desktop lalu coba lagi." }
  if ((Invoke-DockerQuiet @("info")).Code -ne 0) {
    $desktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
    if (Test-Path $desktop) { Write-Note "Menyalakan Docker Desktop..."; Start-Process $desktop }
    $deadline = (Get-Date).AddMinutes(3)
    while ((Invoke-DockerQuiet @("info")).Code -ne 0) {
      if ((Get-Date) -gt $deadline) { Stop-Starnet "Docker belum siap setelah 3 menit. Buka Docker Desktop, tunggu sampai 'running', lalu coba lagi." }
      Start-Sleep -Seconds 5
    }
  }
  $port = ([uri]($settings.databaseUrl -replace "^postgres(ql)?://", "http://")).Port
  $state = (Invoke-DockerQuiet @("ps", "-a", "--filter", "name=^$PgContainer$", "--format", "{{.State}}")).Out
  if (-not $state) {
    Write-Note "Membuat container $PgContainer (sekali saja)"
    $run = Invoke-DockerQuiet @("run", "-d", "--name", $PgContainer, "--restart", "unless-stopped",
      "-e", "POSTGRES_USER=paperclip", "-e", "POSTGRES_PASSWORD=paperclip", "-e", "POSTGRES_DB=paperclip",
      "-p", "127.0.0.1:${port}:5432", "-v", "${PgVolume}:/var/lib/postgresql/data", "postgres:17-alpine")
    if ($run.Code -ne 0) { Stop-Starnet "docker run $PgContainer gagal." }
  } elseif ($state -ne "running") {
    Invoke-DockerQuiet @("start", $PgContainer) | Out-Null
  }
  $deadline = (Get-Date).AddMinutes(2)
  while ((Invoke-DockerQuiet @("exec", $PgContainer, "pg_isready", "-U", "paperclip")).Code -ne 0) {
    if ((Get-Date) -gt $deadline) { Stop-Starnet "Postgres di Docker tidak siap dalam 2 menit." }
    Start-Sleep -Seconds 2
  }
  Write-Ok "Postgres siap (port $port)"
}

function Get-List($Response, [string]$Key) {
  if ($Response -is [array]) { return $Response }
  if ($Response.$Key) { return @($Response.$Key) }
  return @($Response)
}

function Install-StarnetExtensions {
  Write-Step "Plugin dan adapter Starnet"
  $bundle = Get-Content -Raw (Join-Path $BundleDir "bundle.json") | ConvertFrom-Json
  $installed = @{}
  foreach ($p in (Get-List (Invoke-RestMethod -Uri "$Api/plugins") "plugins")) { $installed[[string]$p.pluginKey] = $p }
  foreach ($plugin in $bundle.plugins) {
    if ($installed.ContainsKey([string]$plugin.key)) { continue }
    $path = (Join-Path $BundleDir $plugin.dir) -replace "\\", "/"
    Write-Note "Memasang $($plugin.key)"
    try {
      Invoke-RestMethod -Method Post -Uri "$Api/plugins/install" -ContentType "application/json" -Body (@{ packageName = $path; isLocalPath = $true } | ConvertTo-Json) | Out-Null
    } catch { Write-Warn "$($plugin.key) gagal dipasang: $($_.Exception.Message)" }
  }
  $adapters = Get-List (Invoke-RestMethod -Uri "$Api/adapters") "adapters"
  if (-not ($adapters | Where-Object { $_.type -eq $bundle.adapter.type -and $_.source -eq "external" })) {
    $path = (Join-Path $BundleDir $bundle.adapter.dir) -replace "\\", "/"
    Write-Note "Memasang adapter $($bundle.adapter.type)"
    try {
      Invoke-RestMethod -Method Post -Uri "$Api/adapters/install" -ContentType "application/json" -Body (@{ packageName = $path; isLocalPath = $true } | ConvertTo-Json) | Out-Null
    } catch { Write-Warn "Adapter $($bundle.adapter.type) gagal dipasang: $($_.Exception.Message)" }
  }
  $ready = @(Get-List (Invoke-RestMethod -Uri "$Api/plugins") "plugins" | Where-Object { $_.pluginKey -like "starnet.*" -and $_.status -eq "ready" }).Count
  Write-Ok "$ready dari $(@($bundle.plugins).Count) plugin Starnet siap"
}

Write-Host "Starnet Office ($Base)" -ForegroundColor Cyan
if (Test-Healthy) {
  Write-Ok "Starnet sudah jalan"
  Install-StarnetExtensions
  Start-Process $Base
  exit 0
}

$env:Path = "$NodeDir;$env:Path"
$env:PORT = "$Port"
$env:PAPERCLIP_NO_BROWSER = "1"
$env:PAPERCLIP_OPEN_ON_LISTEN = "false"
if ($settings.databaseUrl) {
  $env:DATABASE_URL = [string]$settings.databaseUrl
  Start-OfficePostgres
}

$firstRun = -not (Test-Path $ConfigFile)
$command = if ($firstRun) { "onboard --yes --no-install-service" } else { "run" }
Write-Step "Menyalakan Paperclip"
if ($firstRun) { Write-Note "Start pertama: menyiapkan database, sekitar 3-5 menit." }
$argLine = "`"$Cli`" $command --data-dir `"$DataDir`""
$proc = Start-Process -FilePath $NodeExe -ArgumentList $argLine -WorkingDirectory $Root -NoNewWindow -PassThru

$started = Get-Date
$nextNote = 60
while (-not (Test-Healthy)) {
  if ($proc.HasExited) { Stop-Starnet "Paperclip berhenti (kode $($proc.ExitCode)). Lihat pesan di atas." }
  $elapsed = ((Get-Date) - $started).TotalSeconds
  if ($elapsed -gt 1200) { Stop-Starnet "Paperclip belum siap setelah 20 menit. Lihat pesan di atas." }
  if ($elapsed -gt $nextNote) { Write-Note "Masih menyiapkan... ($([int]$elapsed) detik)"; $nextNote += 60 }
  Start-Sleep -Seconds 3
}
Write-Ok "Paperclip siap"
Install-StarnetExtensions
Start-Process $Base
Write-Host ""
Write-Host "Starnet Office jalan di $Base. Biarkan jendela ini terbuka; tutup untuk mematikan." -ForegroundColor Green
$proc.WaitForExit()
