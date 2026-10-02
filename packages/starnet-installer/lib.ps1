# Shared helpers for the Starnet developer installer (install-dev.ps1) and launcher (start-dev.ps1).
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
  return ((Invoke-DockerQuick @("info") 20).Code -eq 0)
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

# Docker CLI calls can hang forever while Docker Desktop is half-started (WSL boot, Resource Saver,
# first-run license dialog), so short calls get a hard timeout. Code -1 means timed out.
function Invoke-DockerQuick([string[]]$DockerArgs, [int]$TimeoutSec = 30) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = (Get-Command docker -CommandType Application | Select-Object -First 1).Source
  $psi.Arguments = ($DockerArgs | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join " "
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEndAsync()
  $err = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit($TimeoutSec * 1000)) {
    try { & taskkill /PID $p.Id /T /F *> $null } catch { }
    return @{ Code = -1; Out = ""; Err = "" }
  }
  $p.WaitForExit()
  return @{ Code = $p.ExitCode; Out = $out.Result.Trim(); Err = $err.Result.Trim() }
}

function Stop-DockerUnresponsive {
  Stop-Starnet "Docker tidak merespons. Buka Docker Desktop: setujui lisensi/login kalau diminta, tunggu sampai di pojok kiri bawah tertulis 'Engine running' (bukan 'Resource Saver'), lalu jalankan installer lagi."
}

function Start-StarnetPostgres([int]$TimeoutSec = 120) {
  $ErrorActionPreference = "Continue"
  $name = $script:PostgresContainer
  $image = "postgres:17-alpine"
  Write-Note "Cek container database..."
  $ps = Invoke-DockerQuick @("ps", "-a", "--filter", "name=^$name$", "--format", "{{.Names}}")
  if ($ps.Code -eq -1) { Stop-DockerUnresponsive }
  if ($ps.Out -ne $name) {
    $img = Invoke-DockerQuick @("image", "inspect", $image)
    if ($img.Code -eq -1) { Stop-DockerUnresponsive }
    if ($img.Code -ne 0) {
      Write-Note "Mengunduh image Postgres (~110 MB, sekali saja; tergantung kecepatan internet)..."
      & docker pull $image
      if ($LASTEXITCODE -ne 0) { Stop-Starnet "Gagal mengunduh image $image. Cek koneksi internet lalu jalankan installer lagi." }
    }
    Write-Note "Membuat database Postgres ($name, port $($script:PostgresPort))..."
    $run = Invoke-DockerQuick @("run", "-d", "--name", $name, "--restart", "unless-stopped",
      "-e", "POSTGRES_USER=paperclip", "-e", "POSTGRES_PASSWORD=paperclip", "-e", "POSTGRES_DB=paperclip",
      "-p", "127.0.0.1:$($script:PostgresPort):5432", "-v", "$($script:PostgresVolume):/var/lib/postgresql/data",
      $image) 120
    if ($run.Code -eq -1) { Stop-DockerUnresponsive }
    if ($run.Code -ne 0) { Stop-Starnet "docker run Postgres gagal: $($run.Err) (port $($script:PostgresPort) mungkin dipakai program lain)." }
  } else {
    $state = Invoke-DockerQuick @("inspect", "-f", "{{.State.Running}}", $name)
    if ($state.Code -eq -1) { Stop-DockerUnresponsive }
    if ($state.Out -ne "true") {
      Write-Note "Menyalakan container $name..."
      $start = Invoke-DockerQuick @("start", $name) 60
      if ($start.Code -ne 0) { Stop-Starnet "Container $name tidak bisa dinyalakan: $($start.Err)" }
    }
  }
  $begin = Get-Date
  $lastNote = 0
  while (((Get-Date) - $begin).TotalSeconds -lt $TimeoutSec) {
    $ready = Invoke-DockerQuick @("exec", $name, "pg_isready", "-U", "paperclip", "-d", "paperclip") 15
    if ($ready.Code -eq 0) { Write-Ok "Postgres siap di 127.0.0.1:$($script:PostgresPort)"; return }
    $elapsed = [int]((Get-Date) - $begin).TotalSeconds
    if ($elapsed - $lastNote -ge 15) { Write-Note "Menunggu Postgres siap... ($elapsed detik)"; $lastNote = $elapsed }
    Start-Sleep -Seconds 2
  }
  Stop-Starnet "Postgres belum siap setelah $TimeoutSec detik. Cek: docker logs $name"
}

# POSTGRES_PASSWORD only applies when the volume is first initialised, so a container or volume left over from an
# earlier manual attempt keeps its old password. Inside the container the unix socket is trusted, which lets us reset it.
function Test-StarnetPasswordLogin([string]$Name) {
  # The image trusts 127.0.0.1 without a password; the container's own network address goes through password auth,
  # like the server's connection from Windows does.
  return Invoke-DockerQuick @("exec", "-e", "PGPASSWORD=paperclip", $Name, "sh", "-c",
    'psql -h "$(hostname -i | cut -d" " -f1)" -U paperclip -d paperclip -tAc "select 1"') 20
}

function Repair-StarnetDatabaseLogin {
  $name = $script:PostgresContainer
  $login = Test-StarnetPasswordLogin $name
  if ($login.Code -eq 0) { Write-Ok "Login database cocok"; return }
  Write-Warn "Password database tidak cocok (container/volume dari percobaan lama). Menyetel ulang password user paperclip..."
  $reset = Invoke-DockerQuick @("exec", $name, "psql", "-U", "paperclip", "-d", "postgres", "-tAc", "ALTER USER paperclip WITH PASSWORD 'paperclip'") 20
  $login = Test-StarnetPasswordLogin $name
  if ($reset.Code -eq 0 -and $login.Code -eq 0) { Write-Ok "Password database disetel ulang"; return }
  Stop-Starnet ("Database di container $name tidak bisa dipakai (user/database 'paperclip' tidak ada atau password tidak bisa disetel: " +
    "$($reset.Err) $($login.Err)). Kalau isinya tidak penting, hapus lalu jalankan installer lagi: " +
    "docker rm -f $name; docker volume rm $($script:PostgresVolume)")
}

# The server reads the database from the instance config, not from DATABASE_URL, so an old onboard that pointed
# elsewhere keeps failing. Point it at the Starnet container, keeping a backup of the previous file.
function Sync-InstanceDatabaseUrl {
  $config = Join-Path $script:InstanceDir "config.json"
  if (-not (Test-Path $config)) { return }
  $ErrorActionPreference = "Continue"
  $nodeCode = "const fs=require('fs');const [f,u]=process.argv.slice(1);const c=JSON.parse(fs.readFileSync(f,'utf8'));" +
    "const d=c.database||{};if(d.mode==='postgres'&&d.connectionString===u){console.log('same');process.exit(0)}" +
    "fs.copyFileSync(f,f+'.bak-'+Date.now());c.database={...d,mode:'postgres',connectionString:u};" +
    "fs.writeFileSync(f,JSON.stringify(c,null,2)+'\n');console.log('updated')"
  $result = (& node -e $nodeCode $config $script:DatabaseUrl) -join ""
  if ($LASTEXITCODE -ne 0) { Stop-Starnet "Gagal membaca $config." }
  if ($result -eq "updated") { Write-Warn "Config instance menunjuk ke database lain; diarahkan ke Postgres Starnet (backup: config.json.bak-*)." }
  else { Write-Ok "Config instance memakai Postgres Starnet" }
}

# Same call as the failing upstream postinstall (scripts/link-plugin-dev-sdk.mjs): a directory symlink. Windows
# only allows it for admins or with Developer Mode on.
function Test-DirSymlinkAllowed {
  $probe = Join-Path $env:TEMP ("starnet-symlink-" + [guid]::NewGuid().ToString("N"))
  $ErrorActionPreference = "Continue"
  & node -e "const fs=require('fs');fs.symlinkSync('.',process.argv[1],'dir');fs.rmSync(process.argv[1],{force:true})" $probe *> $null
  $ok = ($LASTEXITCODE -eq 0)
  if (Test-Path $probe) { Remove-Item -Force $probe -ErrorAction SilentlyContinue }
  return $ok
}

function Enable-DeveloperMode {
  $regArgs = 'add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /t REG_DWORD /f /v AllowDevelopmentWithoutDevLicense /d 1'
  try {
    $p = Start-Process -FilePath "reg.exe" -ArgumentList $regArgs -Verb RunAs -Wait -PassThru -WindowStyle Hidden
    return ($p.ExitCode -eq 0)
  } catch {
    return $false
  }
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
