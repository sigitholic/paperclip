> **Ini README fork Starnet.** Dokumentasi inti Paperclip (fitur, konsep, CLI, deploy) ada di
> [README upstream](../README.md), [docs.paperclip.ing](https://docs.paperclip.ing) dan
> [paperclipai/paperclip](https://github.com/paperclipai/paperclip). GitHub menampilkan file ini
> (`.github/README.md`) di halaman depan repo; README upstream di root tidak kita ubah.

# Starnet di atas Paperclip

Repo ini fork dari [Paperclip](https://github.com/paperclipai/paperclip) (MIT), aplikasi open-source
untuk menjalankan "perusahaan" berisi agent AI: org chart, issue/tugas, routine, budget, approval, dan plugin.
Starnet menambahkan kebutuhan ISP/NOC di atasnya **sebagai plugin dan paket baru**, tanpa mengubah
kode inti Paperclip. Isinya: agent **NOC Engineer** dengan tool read-only MikroTik (RouterOS REST) dan
GenieACS, routine cek PPPoE harian, **Office Chat** (ngobrol dengan "kantor", permintaan otomatis jadi
issue untuk agent yang tepat), dan **Virtual Office** (agent tampil sebagai meja dengan status live).
Semuanya jalan dalam **mode mock** (data contoh) sampai kamu mengisi alamat perangkat asli.

Branch utama fork: **`starnet/main`** (default branch). Kerja baru lewat PR ke branch ini.

## Isi repo: punya Starnet vs upstream

| Path | Pemilik | Isi |
| --- | --- | --- |
| `packages/plugins/starnet-pack-isp/` | Starnet | Plugin ISP: 5 tool read-only (`mikrotik.list_routers`, `mikrotik.list_pppoe_active`, `mikrotik.system_resource`, `genieacs.list_devices`, `genieacs.device_status`), multi-MikroTik (REST atau RouterOS API 8728/8729), agent NOC Engineer (adapter `process`) dan NOC Engineer (LLM), routine harian 07:00 WIB, widget dashboard. [README](../packages/plugins/starnet-pack-isp/README.md) |
| `packages/plugins/starnet-office-chat/` | Starnet | Halaman Office Chat. [README](../packages/plugins/starnet-office-chat/README.md) |
| `packages/plugins/starnet-virtual-office/` | Starnet | Halaman Virtual Office + widget. [README](../packages/plugins/starnet-virtual-office/README.md) |
| `packages/plugins/starnet-pack-nms/` | Starnet | Plugin NMS: 3 tool read-only (`nms.list_sources`, `nms.list_problems`, `nms.host_status`) untuk Zabbix + LibreNMS, webhook alert → issue NOC, widget dashboard. [README](../packages/plugins/starnet-pack-nms/README.md) |
| `packages/plugins/starnet-pack-kit/` | Starnet | Helper bersama untuk pack Starnet (`fetchJson`, `tierTemplate`, `qualifyTool`). |
| `packages/starnet-devkit/` | Starnet | Seed demo, server palsu RouterOS/GenieACS, E2E, skrip sync upstream, guard "no core edits", `check:models`, `apply-tier`. [README](../packages/starnet-devkit/README.md) |
| `packages/plugins/starnet-memory/` | Starnet | Plugin Starnet Memory: L1 per issue/agent, pin, context pack untuk agent, halaman Memory. |
| `packages/starnet-memory-core/` | Starnet | Logika Starnet Memory (Phase 1, library murni). [README](../packages/starnet-memory-core/README.md) |
| `.github/workflows/starnet-ci.yml`, `starnet-upstream-sync.yml` | Starnet | CI khusus Starnet + sync upstream mingguan. |
| `.github/README.md` (file ini), [`STARNET_PATCHES.md`](../STARNET_PATCHES.md) | Starnet | Dokumentasi fork. |
| Semua file lain (`server/`, `ui/`, `cli/`, `packages/*` lain, `README.md` root, dst.) | Upstream | Paperclip asli. **Jangan diedit.** |

**Aturan keras:** kerja Starnet hanya *menambah file* di path Starnet di atas. Satu-satunya pengecualian
adalah patch core **P-0** (bridge stream plugin, 4 file di `server/`) yang dicatat di
[`STARNET_PATCHES.md`](../STARNET_PATCHES.md). CI (`starnet-ci`) menjalankan
`packages/starnet-devkit/scripts/core-diff-check.mjs` dan gagal kalau ada file core lain yang berubah.

## Status rencana

- **Phase 0 (fondasi) — selesai:** plugin ISP, Office Chat, Virtual Office, patch stream P-0, CI Starnet,
  devkit + E2E, sync upstream mingguan, least-privilege agent NOC.
- **Phase 1 (Starnet Memory) — selesai:** `packages/starnet-memory-core`, plugin `starnet.memory`, Memory UI.
- **Phase 3 (Tier model) — selesai:** tier template, `apply-tier`, `check:models`.
- **Pack NMS (Zabbix + LibreNMS) — selesai:** `packages/plugins/starnet-pack-nms`, 3 tool read-only, webhook alert.
- **Pack ISP — ditambah:** multi-MikroTik, RouterOS API transport (8728/8729), UI compact.
- **Phase 2 — sebagian:** NOC Engineer (LLM) menjawab lewat tool gateway; konteks otomatis, batas loop, QA gate belum.
- **Phase 4–6 — rencana:** pack OLT/billing + write tool di balik approval, agent factory/template, multi-tenant.

Daftar patch core dan usulan PR upstream: [`STARNET_PATCHES.md`](../STARNET_PATCHES.md).
Riwayat per langkah: [PR yang sudah di-merge](https://github.com/sigitholic/paperclip/pulls?q=is%3Apr+is%3Amerged+base%3Astarnet%2Fmain).

## Prasyarat

| Kebutuhan | Versi / catatan |
| --- | --- |
| Git | apa saja yang baru |
| Node.js | **≥ 24.11** (`node -v`). Repo punya `.nvmrc`, jadi dengan nvm cukup `nvm install && nvm use`. |
| pnpm | **9.15.4**, otomatis lewat Corepack (`corepack enable`). Jangan pakai pnpm global versi lain. |
| Rust (cargo) | Toolchain stable via [rustup](https://rustup.rs). `pnpm dev` meng-compile binary native `paperclip-runnerd` saat pertama jalan (±2–5 menit). |
| Compiler C | Linux: `build-essential` (Debian/Ubuntu). macOS: `xcode-select --install`. |
| OS | Linux atau macOS. Windows: pakai WSL2 (Ubuntu) dan clone di dalam filesystem WSL (`~/...`), bukan di `/mnt/c/...`, atau jalankan langsung di Windows lewat [langkah khusus Windows](#windows-tanpa-wsl). |
| Port bebas | `3100` (API + UI), `13100` (Vite HMR), `54329` (Postgres embedded). |

PostgreSQL **tidak perlu** di-install: Paperclip menjalankan Postgres embedded sendiri. Data disimpan di
`~/.paperclip/instances/default/`. Pastikan variabel `DATABASE_URL` **tidak** ter-set di shell kamu. Kalau
ter-set, Paperclip akan memakai database itu, bukan Postgres embedded.

## Quickstart

**Terminal 1** — clone, install, setup awal, jalankan:

```bash
git clone https://github.com/sigitholic/paperclip.git starnet-paperclip
cd starnet-paperclip
corepack enable
pnpm install
pnpm paperclipai onboard --yes --no-install-service
```

Kalau Corepack bertanya mau mengunduh pnpm, jawab `Y`. (Node tanpa Corepack: `npm install -g corepack`.)

`onboard` cukup sekali. Perintah ini membuat config dan secret instance (termasuk
`PAPERCLIP_AGENT_JWT_SECRET`, wajib supaya agent bisa memanggil API) di `~/.paperclip/instances/default/`,
lalu langsung menyalakan Paperclip. Setelah banner PAPERCLIP muncul, tekan **Ctrl+C**, lalu jalankan
mode dev (watch) yang dipakai sehari-hari:

```bash
pnpm dev
```

Pertama kali `pnpm dev` butuh beberapa menit (compile Rust + build SDK). Tunggu sampai banner menampilkan
`Server 3100`. UI: <http://localhost:3100>.

**Terminal 2** — build plugin Starnet, seed demo, jalankan E2E:

```bash
cd starnet-paperclip
pnpm --filter "./packages/plugins/starnet-*" build
node packages/starnet-devkit/scripts/demo-seed.mjs
pnpm --filter @starnet/devkit e2e
```

Hasil yang diharapkan: seed mencetak `seeded Starnet Demo [STA] mode=mock ...` dan E2E `2 passed`.

## Windows (tanpa WSL)

Paperclip bisa jalan langsung di Windows dengan Git Bash, tapi ada dua hal yang berbeda dari Linux/macOS:

- pnpm di Windows menjalankan script lewat `cmd.exe`, padahal beberapa script build memakai perintah
  Unix (`mkdir -p`, `cp`). pnpm harus diarahkan ke Git Bash.
- Postgres embedded menolak jalan kalau user Windows punya hak administrator
  (`Execution of PostgreSQL by a user with administrative permissions is not permitted`). Postgres
  dijalankan di Docker, lalu Paperclip diarahkan ke sana.

Prasyarat tambahan: [Git for Windows](https://git-scm.com/download/win) (Git Bash),
[Docker Desktop](https://www.docker.com/products/docker-desktop/), dan untuk Rust: rustup plus
Visual Studio Build Tools dengan workload **Desktop development with C++** (linker MSVC).

Semua perintah di bawah dijalankan di **Git Bash**:

```bash
# 1. Node 24 LTS, Rust, pnpm
winget install OpenJS.NodeJS.LTS Rustlang.Rustup
corepack enable

# 2. Arahkan pnpm ke Git Bash (sekali per komputer)
pnpm config set script-shell "C:\\Program Files\\Git\\bin\\bash.exe"

# 3. Postgres di Docker (Docker Desktop harus sudah jalan)
docker run -d --name paperclip-postgres --restart unless-stopped \
  -e POSTGRES_USER=paperclip -e POSTGRES_PASSWORD=paperclip -e POSTGRES_DB=paperclip \
  -p 127.0.0.1:5441:5432 -v paperclip-pgdata:/var/lib/postgresql/data \
  postgres:17-alpine

# 4. Clone, install, onboard sekali dengan DATABASE_URL
git clone https://github.com/sigitholic/paperclip.git starnet-paperclip
cd starnet-paperclip
pnpm install
DATABASE_URL=postgres://paperclip:paperclip@127.0.0.1:5441/paperclip \
  pnpm paperclipai onboard --yes --no-install-service
```

Buka terminal baru setelah `winget install` supaya `node` dan `cargo` terbaca. `onboard` menyimpan
alamat database ke `~/.paperclip/instances/default/config.json`, jadi setelah itu `DATABASE_URL` tidak
perlu di-set lagi. Tekan **Ctrl+C** setelah banner muncul, lalu jalankan seperti biasa:

```bash
pnpm dev
```

Banner harus menampilkan `Database  postgres://paperclip:***@127.0.0.1:5441/paperclip`. UI:
<http://127.0.0.1:3100>. Setiap kali komputer dinyalakan, pastikan Docker Desktop sudah jalan sebelum
`pnpm dev`.

**Menghentikan server.** Tekan Ctrl+C di terminal tempat `pnpm dev` jalan. Kalau terminalnya sudah
tertutup dan server masih jalan di background, cari PID pemilik port 3100 lalu matikan seluruh rantainya:

```bash
netstat -ano | findstr :3100
taskkill //PID <PID> //T //F
```

Di Git Bash flag `taskkill` ditulis dengan dua garis miring (`//PID`), karena satu garis miring diubah
Git Bash menjadi path. Di `cmd.exe` cukup satu (`/PID`). `pnpm dev:stop` hanya menghentikan proses
yang tercatat di registry service, jadi bisa saja tidak mengenai server yang sedang memakai port.

## Setup awal: apa yang dilakukan seed

`demo-seed.mjs` idempotent (aman dijalankan ulang). Urutannya:

1. **Install plugin** (sekali per instance) dari path lokal, kalau belum ada: `starnet.pack-isp`,
   `starnet.office-chat`, `starnet.virtual-office`, `starnet.memory`, `starnet.pack-nms`. Plugin harus sudah
   di-build (langkah `build` di atas).
2. **Buat company** "Starnet Demo" (prefix `STA`). Pakai `--company "Nama Lain"` untuk company lain,
   termasuk company yang sudah kamu buat di UI.
3. **Setup pack ISP:** membuat agent **NOC Engineer** dan routine **Daily PPPoE check**, lalu mengecilkan
   izin agent NOC (tidak bisa merekrut agent, membuat skill, atau assign task).
4. **Langkah board (wajib): tool profile.** Tool gateway Paperclip *deny-by-default*: plugin tidak bisa
   memberi akses tool ke agent, harus board (manusia). Seed membuat tool profile
   **"Starnet NOC (read-only)"** (`defaultAction: deny`, hanya tool read-only `starnet.pack-isp:*` dan
   `starnet.pack-nms:*`) dan mem-bind-nya ke kedua agent NOC. Tanpa langkah ini NOC Engineer tidak bisa memanggil tool apa pun.
5. **Config pack:** mode mock (default) atau `--live` (ke server palsu di `127.0.0.1`).

Mau melakukannya manual (tanpa seed)? Install plugin dengan CLI, lalu ikuti langkah "Setup" di
[README pack ISP](../packages/plugins/starnet-pack-isp/README.md#setup-once-per-company):

```bash
pnpm paperclipai plugin install ./packages/plugins/starnet-pack-isp
pnpm paperclipai plugin install ./packages/plugins/starnet-office-chat
pnpm paperclipai plugin install ./packages/plugins/starnet-virtual-office
```

## Coba Office Chat dan Virtual Office

1. Buka <http://localhost:3100/STA/office-chat> (atau klik **Office Chat** di sidebar company Starnet Demo).
2. Ketik: **`cek PPPoE aktif di router`**.
3. Office Chat membuat issue (mis. `STA-5`) untuk **NOC Engineer** dan membangunkannya. Agent memanggil
   tool lewat tool gateway, balasannya muncul di chat dalam ±1–2 detik, lalu issue jadi `done`
   ("STA-5 selesai ✅"). Di mode mock hasilnya diawali `[MOCK DATA — no device configured]`.
4. Buka <http://localhost:3100/STA/virtual-office> di tab lain. Meja NOC Engineer jadi **busy** selama
   run berjalan dan kembali **idle**. Update-nya live lewat stream (patch P-0), tanpa polling.

Run NOC sangat cepat. Supaya status busy kelihatan lebih lama, tambahkan env `NOC_DEMO_DELAY_MS=8000`
di konfigurasi adapter agent NOC Engineer (maks. 60 detik).

Prefix `STA` diambil dari nama company. Kalau berbeda, lihat prefix di URL/sidebar.

## Demo "live" dengan perangkat palsu

Tanpa router asli, kamu bisa menguji jalur live (HTTP sungguhan + password lewat secret):

```bash
node packages/starnet-devkit/scripts/demo-seed.mjs --live
pnpm --filter @starnet/devkit e2e
```

E2E menyalakan server palsu RouterOS (`127.0.0.1:18728`) dan GenieACS (`127.0.0.1:17557`) sendiri.
Untuk dicoba manual di Office Chat, jalankan dulu `node packages/starnet-devkit/scripts/fake-servers.mjs`
di terminal terpisah. Balasan live berisi `FAKE-CCR2004`. Kembali ke mock:
`node packages/starnet-devkit/scripts/demo-seed.mjs --mock`.

## Menghubungkan MikroTik dan GenieACS asli

Aturan: **password tidak pernah ditulis ke file, config, atau chat.** Password disimpan sebagai
*company secret* Paperclip (terenkripsi di instance). Config plugin hanya menyimpan referensinya
(`{ "type": "secret_ref", "secretId": "..." }`).

Di sisi perangkat:

- Buat user RouterOS khusus dengan **group read-only**, dan aktifkan REST API (RouterOS ≥ 7.1).
- Node menolak sertifikat self-signed. Pakai sertifikat CA/CA internal (percayakan lewat
  `NODE_EXTRA_CA_CERTS`) atau HTTP biasa hanya di VLAN manajemen (`mikrotikUseTls: false`).

**Lewat UI (paling mudah):**

1. Buka **Company Settings → Plugins → Starnet ISP Pack** (tab **Configuration**).
2. Isi `Mikrotik Host`, `Mikrotik Port`, `Mikrotik Use Tls`, `Mikrotik Username`, dan `Genieacs Base Url`.
3. Untuk `Mikrotik Password` (dan `Genieacs Password` kalau perlu), pilih secret yang sudah ada
   (dibuat di **Company Settings → Secrets**) atau tempel password di kolom itu. Paperclip menyimpannya
   sebagai secret saat **Save Configuration**, dan config hanya berisi referensinya.

**Lewat API** (password diketik tersembunyi, tidak masuk history shell):

```bash
BASE=http://localhost:3100
COMPANY="Starnet Demo"
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(new Function("v","return "+process.argv[1])(JSON.parse(s))))' "$1"; }
COMPANY_ID=$(curl -s $BASE/api/companies | json "v.find(c=>c.name==='$COMPANY').id")
PLUGIN_ID=$(curl -s $BASE/api/plugins | json "(v.plugins??v).find(p=>p.pluginKey==='starnet.pack-isp').id")

read -rsp "Password RouterOS (user read-only): " PW; echo
SECRET_ID=$(PW="$PW" node -e 'process.stdout.write(JSON.stringify({name:"mikrotik-noc-ro",value:process.env.PW}))' \
  | curl -s -X POST $BASE/api/companies/$COMPANY_ID/secrets -H 'content-type: application/json' --data-binary @- \
  | json "v.id")
unset PW

curl -s -X POST $BASE/api/plugins/$PLUGIN_ID/config -H 'content-type: application/json' -d '{
  "companyId": "'$COMPANY_ID'",
  "configJson": {
    "mikrotikHost": "192.168.88.1", "mikrotikPort": 443, "mikrotikUseTls": true,
    "mikrotikUsername": "noc-ro",
    "mikrotikPassword": { "type": "secret_ref", "secretId": "'$SECRET_ID'" },
    "genieacsBaseUrl": "http://acs.lan:7557"
  }
}'
```

Ganti host, port, username, dan URL GenieACS sesuai jaringanmu. Untuk GenieACS dengan auth, buat secret
kedua dan isi `genieacsUsername` + `genieacsPassword` (secret-ref) dengan cara yang sama. Sumber yang
host-nya kosong tetap mock. Semua key config ada di
[README pack ISP](../packages/plugins/starnet-pack-isp/README.md#config-per-company).

## Test

```bash
# unit test semua paket Starnet (sama seperti CI)
pnpm --filter "./packages/plugins/starnet-*" --filter "./packages/starnet-*" test

# typecheck
pnpm --filter "./packages/plugins/starnet-*" --filter "./packages/starnet-*" --workspace-concurrency=1 typecheck

# E2E terhadap instance yang sedang jalan (dilewati kalau instance mati)
pnpm --filter @starnet/devkit e2e
```

Devkit memakai `PAPERCLIP_URL` (default `http://127.0.0.1:3100`) dan hanya mau bicara ke localhost.

## Update

```bash
git pull
pnpm install
pnpm --filter "./packages/plugins/starnet-*" build
```

Lalu restart `pnpm dev` (Ctrl+C, jalankan lagi). Migrasi database jalan otomatis saat start. Seed dan
E2E boleh dijalankan ulang untuk mengecek.

Perubahan dari upstream Paperclip masuk ke `starnet/main` lewat **sync mingguan** (workflow
`starnet-upstream-sync`, Senin 02:00 WIB) sebagai PR *merge* (bukan rebase) yang harus hijau di CI.
Jadi kamu cukup `git pull` dari fork ini; tidak perlu menarik upstream sendiri.

## Troubleshooting

| Gejala | Penyebab / solusi |
| --- | --- |
| Port 3100 sudah dipakai | Paperclip otomatis pindah ke port bebas berikutnya. Lihat baris `Server` di banner. Atau pilih sendiri: `PORT=3200 pnpm dev`. Untuk devkit, set `PAPERCLIP_URL=http://127.0.0.1:3200`. |
| Port 54329 (Postgres) dipakai | Otomatis pindah ke port bebas berikutnya (lihat `Database ... (pg:NNNNN)` di banner). |
| `Unsupported engine` / error aneh saat install | Node terlalu lama. `node -v` harus ≥ 24.11 (`nvm install && nvm use`). |
| `pnpm -v` bukan 9.15.4 di folder repo | Jalankan `corepack enable`, buka terminal baru. |
| `paperclip runner native binary build failed` | Rust/cargo atau compiler C belum ada. Install rustup + `build-essential` / Xcode CLT, lalu `pnpm dev` lagi. |
| Run NOC gagal `401 Agent token did not verify` | Langkah `onboard` terlewat (secret JWT agent tidak ada). Hentikan `pnpm dev`, jalankan `pnpm paperclipai onboard --yes --no-install-service`, Ctrl+C setelah banner, lalu `pnpm dev`. |
| Seed: `... is not built` | Jalankan `pnpm --filter "./packages/plugins/starnet-*" build`. |
| Seed/E2E: `Paperclip is not reachable` | `pnpm dev` belum siap atau port lain. Cek `curl http://127.0.0.1:3100/api/health`. |
| Postgres embedded tidak mau start setelah crash | Pastikan tidak ada proses Paperclip lain yang masih jalan (`pnpm dev:list`; hentikan dengan Ctrl+C di terminalnya atau `pnpm dev:stop`), lalu start lagi. Paperclip otomatis memakai ulang atau membersihkan Postgres miliknya. **Reset total** (hapus semua data lokal): hentikan Paperclip, hapus `~/.paperclip/instances/default`, lalu ulangi `onboard`. |
| Windows: `The syntax of the command is incorrect` saat build `@paperclipai/shared` | pnpm masih memakai `cmd.exe`. Jalankan `pnpm config set script-shell "C:\\Program Files\\Git\\bin\\bash.exe"`, lalu `pnpm dev` lagi. Error `Command "tsx" not found` yang muncul sesudahnya cuma akibat dari build yang gagal ini. |
| Windows: `Execution of PostgreSQL by a user with administrative permissions is not permitted` | Postgres embedded tidak bisa jalan di akun admin. Pakai Postgres di Docker dan `onboard` dengan `DATABASE_URL` seperti di [langkah Windows](#windows-tanpa-wsl). |
| Windows: `No such built-in module: node:sqlite` | Node terlalu lama. Install Node 24 (`winget install OpenJS.NodeJS.LTS`), buka terminal baru, cek `node -v`. |
| Windows: `connect ECONNREFUSED 127.0.0.1:5441` | Docker Desktop atau container `paperclip-postgres` belum jalan. Jalankan `docker start paperclip-postgres`. |
| Server masih jalan di background setelah terminal ditutup | Cari PID dengan `netstat -ano \| findstr :3100`, lalu `taskkill //PID <PID> //T //F` (Git Bash). |
| Ingin instance terpisah untuk eksperimen | `PORT=3200 pnpm dev --data-dir ./tmp/pc-lab` (data di folder itu, tidak mengganggu instance utama). |
| Telemetri | Matikan dengan `PAPERCLIP_TELEMETRY_DISABLED=1`. |

## Link

- [`STARNET_PATCHES.md`](../STARNET_PATCHES.md): patch core P-0, usulan PR upstream, pengaturan CI fork.
- [README pack ISP](../packages/plugins/starnet-pack-isp/README.md) · [Office Chat](../packages/plugins/starnet-office-chat/README.md) · [Virtual Office](../packages/plugins/starnet-virtual-office/README.md) · [Devkit](../packages/starnet-devkit/README.md)
- Dokumentasi Paperclip: [README upstream](../README.md) · [doc/DEVELOPING.md](../doc/DEVELOPING.md) · [docs.paperclip.ing](https://docs.paperclip.ing)
