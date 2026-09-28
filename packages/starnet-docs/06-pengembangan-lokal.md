# 6. Pengembangan lokal

Quickstart resmi ada di [`.github/README.md`](../../.github/README.md). Dokumen ini merangkumnya dan menambahkan catatan
untuk Windows native, yang tidak didukung resmi tetapi sudah dicoba pada 27 Sep 2026.

## 6.1 Prasyarat

| Kebutuhan | Versi / catatan |
|---|---|
| Node.js | ≥ 24.11 (repo punya `.nvmrc`) |
| pnpm | 9.15.4 lewat Corepack (`corepack enable`) |
| Rust (cargo) | Toolchain stable; `pnpm dev` meng-compile `paperclip-runnerd` saat pertama jalan (sekitar 2–5 menit) |
| Compiler C | Linux: `build-essential`; macOS: Xcode CLT |
| OS | Linux atau macOS. Windows: **WSL2** (clone di `~/...`, bukan `/mnt/c/...`) |
| Port | 3100 (API + UI), 13100 (Vite HMR), 54329 (Postgres embedded) |

## 6.2 Linux, macOS, WSL2 (jalur resmi)

```sh
git clone https://github.com/sigitholic/paperclip.git starnet-paperclip
cd starnet-paperclip
corepack enable
pnpm install
pnpm paperclipai onboard --yes --no-install-service   # sekali; Ctrl+C setelah banner
pnpm dev                                              # tunggu "Server 3100"
```

Terminal kedua:

```sh
pnpm --filter "./packages/plugins/starnet-*" build
node packages/starnet-devkit/scripts/demo-seed.mjs    # company "Starnet Demo", mode mock
pnpm --filter @starnet/devkit e2e                     # harapan: semua lulus
```

Lalu buka `http://localhost:3100/<PREFIX>/office-chat` dan ketik `cek PPPoE aktif di router`. Prefix diambil dari nama
company (misalnya `STA`, atau `STAA` kalau `STA` sudah dipakai).

Jangan set `DATABASE_URL` di jalur resmi; Paperclip memakai Postgres embedded dan menyimpan data di
`~/.paperclip/instances/default/`.

## 6.3 Windows native (tidak resmi)

Bisa jalan, tetapi butuh tiga penyesuaian. Semuanya ditemukan saat menjalankan proyek di Windows 11.

### a. PostgreSQL embedded menolak jalan sebagai Administrator

Gejala: `Execution of PostgreSQL by a user with administrative permissions is not permitted.`

Penyebab: kalau UAC dimatikan (`EnableLUA = 0`), semua proses (termasuk Explorer dan editor) berjalan sebagai
Administrator, dan tidak ada cara menurunkan haknya. `runas /trustlevel` juga gagal.

Solusi yang dipakai: Postgres eksternal di Docker, lalu onboard dengan `DATABASE_URL`:

```sh
docker run -d --name paperclip-postgres --restart unless-stopped \
  -e POSTGRES_USER=paperclip -e POSTGRES_PASSWORD=paperclip -e POSTGRES_DB=paperclip \
  -p 127.0.0.1:5441:5432 -v paperclip-pgdata:/var/lib/postgresql/data postgres:17-alpine

DATABASE_URL=postgres://paperclip:paperclip@127.0.0.1:5441/paperclip \
  pnpm paperclipai onboard --yes --no-install-service
```

Onboard menyimpan koneksi itu ke `~/.paperclip/instances/default/config.json`, jadi `pnpm dev` berikutnya otomatis
memakai Postgres Docker. Alternatif: nyalakan lagi UAC lalu reboot, atau pakai WSL2.

### b. Script build memakai perintah Unix

Gejala: build `@paperclipai/shared` gagal dengan `The syntax of the command is incorrect.`

Penyebab: pnpm menjalankan script lewat `cmd.exe`, yang tidak mengenal `mkdir -p` dan `cp`.

Solusi: jalankan pnpm dengan Git Bash sebagai shell script:

```sh
npm_config_script_shell='C:\Program Files\Git\bin\bash.exe' pnpm dev
```

Atau permanen (berlaku untuk semua proyek pnpm di mesin itu):

```sh
pnpm config set script-shell "C:\\Program Files\\Git\\bin\\bash.exe"
```

### c. Install plugin lokal gagal (bug core, path Windows)

Gejala: `POST /plugins/install -> 400`, worker plugin crash dengan `ERR_UNSUPPORTED_ESM_URL_SCHEME ... Received protocol 'e:'`.

Penyebab: `server/src/services/plugin-loader.ts` mem-fork worker dengan `--import <path absolut>`. Di Windows, Node
mewajibkan URL `file://`.

Solusi **lokal saja, jangan di-commit** (file core; tercatat sebagai kandidat PR upstream 7 di `STARNET_PATCHES.md`):

```ts
workerOptions.execArgv = ["--import", pathToFileURL(DEV_TSX_LOADER_PATH).href];
```

Patch ini hilang kalau file itu di-reset atau ditimpa `git pull`.

### Catatan Windows lain

- `core.autocrlf=true` membuat file hasil generate di `packages/paperclip-runner` tampil berubah (hanya line ending).
  Jangan ikut di-commit.
- `demo-seed.mjs` sebelumnya diam tanpa output di Windows karena guard `import.meta.url === file://${argv[1]}`; sudah
  diperbaiki memakai `pathToFileURL`.

## 6.4 Perintah harian

| Tujuan | Perintah |
|---|---|
| Cek kesehatan | `curl http://127.0.0.1:3100/api/health` (harapan `status: ok`, `bootstrapStatus: ready`) |
| Daftar/hentikan dev server | `pnpm dev:list`, `pnpm dev:stop` |
| Demo live dengan perangkat palsu | `node packages/starnet-devkit/scripts/demo-seed.mjs --live` lalu `node packages/starnet-devkit/scripts/fake-servers.mjs` |
| Kembali ke mock | `node packages/starnet-devkit/scripts/demo-seed.mjs --mock` |
| Tampilkan status "busy" lebih lama | env `NOC_DEMO_DELAY_MS=8000` di `adapterConfig.env` agent NOC (maks 60 detik) |
| Update | `git pull`, `pnpm install`, build plugin Starnet, restart `pnpm dev` |
| Instance terpisah untuk eksperimen | `PORT=3200 pnpm dev --data-dir ./tmp/pc-lab` |
| Matikan telemetri | `PAPERCLIP_TELEMETRY_DISABLED=1` |

## 6.5 Menghubungkan perangkat asli

Ringkasnya (detail di README Starnet dan README pack-isp):

1. Di RouterOS, buat user khusus dengan group **read-only** dan aktifkan REST API (RouterOS ≥ 7.1).
2. Simpan password sebagai company secret (**Company Settings → Secrets**).
3. Isi config plugin **Starnet ISP Pack** (host, port, TLS, username, secret untuk password, URL GenieACS).
4. Sertifikat self-signed ditolak Node: pakai CA internal (`NODE_EXTRA_CA_CERTS`) atau HTTP biasa hanya di VLAN
   manajemen.

Sumber yang host-nya kosong tetap mock.
