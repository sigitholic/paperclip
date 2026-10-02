# Shared helpers for the Starnet Windows installer (install.ps1) and launcher (start.ps1).
# Windows PowerShell 5.1 compatible; keep this file ASCII-only (5.1 reads BOM-less files as ANSI).

$script:StarnetHome = Join-Path $HOME ".starnet"
$script:StarnetBin = Join-Path $script:StarnetHome "bin"
$script:PostgresContainer = "paperclip-postgres"
$script:PostgresVolume = "paperclip-pgdata"
$script:PostgresPort = 5441
$script:DatabaseUrl = "postgres://paperclip:paperclip@127.0.0.1:$($script:PostgresPort)/paperclip"
$script:InstanceDir = Join-Path $HOME ".paperclip\instances\default"
$script:PaperclipUrl = "http://127.0.0.1:3100"

function Write-Step([string]$Text) { Write-Host ""; Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    OK  $Text" -ForegroundColor Green }
function Write-Note([string]$Text) { Write-Host "    ..  $Text" -ForegroundColor Gray }
function Write-Warn([string]$Text) { Write-Host "    !!  $Text" -ForegroundColor Yellow }
function Stop-Starnet([string]$Text) {
  Write-Host ""
  Write-Host "GAGAL: $Text" -ForegroundColor Red
  throw $Text
}

function Test-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# Re-read PATH from the registry so tools installed by winget in this session are found.
function Update-SessionPath {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $extra = @(
    $script:StarnetBin,
    "$HOME\.cargo\bin",
    "$env:ProgramFiles\Git\cmd",
    "${env:ProgramFiles(x86)}\Git\cmd",
    "$env:LOCALAPPDATA\Programs\Git\cmd",
    "$env:ProgramFiles\nodejs",
    "$env:ProgramFiles\Docker\Docker\resources\bin"
  ) | Where-Object { $_ -notmatch "^\\" -and (Test-Path $_) }
  $env:Path = (@($extra) + @($machine, $user) | Where-Object { $_ }) -join ";"
}

function Get-GitBash {
  $git = Get-Command git -ErrorAction SilentlyContinue
  $candidates = @()
  if ($git) { $candidates += (Join-Path (Split-Path (Split-Path $git.Source)) "bin\bash.exe") }
  $candidates += (Join-Path $env:ProgramFiles "Git\bin\bash.exe")
  $candidates += (Join-Path $env:LOCALAPPDATA "Programs\Git\bin\bash.exe")
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  return $null
}

# pnpm on Windows runs package scripts through cmd.exe, but several repo scripts use Unix
# commands. Point pnpm at Git Bash for this process only (no global npm config change), and
# make Corepack fetch the pinned pnpm without asking.
function Use-StarnetShell {
  Update-SessionPath
  $bash = Get-GitBash
  if (-not $bash) { Stop-Starnet "Git Bash tidak ditemukan. Install Git for Windows lalu jalankan installer lagi." }
  $env:npm_config_script_shell = $bash
  $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0"
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}

function Get-DockerDesktopExe {
  return (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe")
}

# Native tools write progress to stderr; under "Stop" Windows PowerShell 5.1 turns that into a
# terminating error, so functions that call them use "Continue" and check $LASTEXITCODE.

function Test-DockerEngine {
  $ErrorActionPreference = "Continue"
  & docker info *> $null
  return ($LASTEXITCODE -eq 0)
}

function Start-DockerEngine([int]$TimeoutSec = 240) {
  Update-SessionPath
  if (-not (Test-Command docker)) {
    $cli = Join-Path $env:ProgramFiles "Docker\Docker\resources\bin"
    if (Test-Path $cli) { $env:Path = "$cli;$env:Path" } else { Stop-Starnet "Docker belum terpasang." }
  }
  if (Test-DockerEngine) { Write-Ok "Docker sudah jalan"; return }
  $exe = Get-DockerDesktopExe
  if (-not (Test-Path $exe)) { Stop-Starnet "Docker Desktop tidak ditemukan di $exe." }
  Write-Note "Menyalakan Docker Desktop (bisa 1-3 menit)..."
  Start-Process -FilePath $exe | Out-Null
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    if (Test-DockerEngine) { Write-Ok "Docker siap"; return }
  }
  Stop-Starnet "Docker Desktop belum siap setelah $TimeoutSec detik. Buka Docker Desktop, tunggu sampai statusnya 'running', lalu coba lagi."
}

function Start-StarnetPostgres([int]$TimeoutSec = 90) {
  $ErrorActionPreference = "Continue"
  $name = $script:PostgresContainer
  $exists = (& docker ps -a --filter "name=^$name$" --format "{{.Names}}") -eq $name
  if (-not $exists) {
    Write-Note "Membuat database Postgres ($name, port $($script:PostgresPort))..."
    & docker run -d --name $name --restart unless-stopped `
      -e POSTGRES_USER=paperclip -e POSTGRES_PASSWORD=paperclip -e POSTGRES_DB=paperclip `
      -p "127.0.0.1:$($script:PostgresPort):5432" -v "$($script:PostgresVolume):/var/lib/postgresql/data" `
      postgres:17-alpine | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-Starnet "docker run Postgres gagal (port $($script:PostgresPort) mungkin dipakai program lain)." }
  } else {
    $running = (& docker inspect -f "{{.State.Running}}" $name) -eq "true"
    if (-not $running) {
      & docker start $name | Out-Null
      if ($LASTEXITCODE -ne 0) { Stop-Starnet "Container $name tidak bisa dinyalakan." }
    }
  }
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    & docker exec $name pg_isready -U paperclip -d paperclip *> $null
    if ($LASTEXITCODE -eq 0) { Write-Ok "Postgres siap di 127.0.0.1:$($script:PostgresPort)"; return }
    Start-Sleep -Seconds 2
  }
  Stop-Starnet "Postgres belum siap setelah $TimeoutSec detik. Cek: docker logs $name"
}

function Test-PaperclipHealth {
  try {
    $r = Invoke-WebRequest -Uri "$($script:PaperclipUrl)/api/health" -UseBasicParsing -TimeoutSec 3
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Test-Onboarded {
  $envFile = Join-Path $script:InstanceDir ".env"
  $config = Join-Path $script:InstanceDir "config.json"
  if (-not ((Test-Path $config) -and (Test-Path $envFile))) { return $false }
  return [bool](Select-String -Path $envFile -Pattern "PAPERCLIP_AGENT_JWT_SECRET=" -Quiet)
}

function Stop-ProcessTree([int]$ProcessId) {
  $ErrorActionPreference = "Continue"
  & taskkill /PID $ProcessId /T /F *> $null
}
