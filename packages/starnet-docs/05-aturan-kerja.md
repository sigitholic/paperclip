# 5. Aturan kerja dan kontribusi

## 5.1 Aturan no-core-edits

Kerja Starnet hanya **menambah file** di path milik Starnet. Daftar resminya ada di `STARNET_OWNED` pada
`packages/starnet-devkit/scripts/core-diff-check.mjs`:

| Path | Isi |
|---|---|
| `packages/plugins/starnet-*` | Plugin Starnet |
| `packages/adapters/starnet-*` | Adapter Starnet (untuk Fase 2) |
| `packages/starnet-*` | Library, devkit, dokumentasi |
| `.github/workflows/starnet-*.yml` | Workflow CI dan sync Starnet |
| `.github/README.md` | README Starnet di halaman depan GitHub |
| `STARNET_PATCHES.md` | Daftar patch core dan kandidat PR upstream |
| `pnpm-lock.yaml` | Hanya entri importer untuk paket kami |

Semua file lain milik upstream Paperclip dan **tidak boleh diedit**, termasuk README root dan workflow upstream.

### Patch core P-0 (satu-satunya pengecualian)

Stream bridge plugin: `server/src/app.ts`, `server/src/services/plugin-loader.ts`,
`server/src/services/plugin-stream-bus.ts`, dan tes `server/src/__tests__/plugin-stream-bridge.test.ts`. Tanpa patch
ini, `GET /api/plugins/:id/bridge/stream/:channel` mengembalikan 501 dan `usePluginStream` tidak tersambung. Patch
dihapus setelah upstream menerima perbaikan setara (draf usulan di branch `upstream-prop/plugin-stream`).

Menambah file ke `APPROVED_CORE_FILES` butuh **persetujuan eksplisit Sigit** dan harus dicatat di `STARNET_PATCHES.md`.

### Kalau butuh perubahan core

1. Cari cara lewat plugin SDK dulu (event, action, data, state, managed agent/routine, slot UI).
2. Kalau tidak bisa, catat sebagai kandidat PR upstream di `STARNET_PATCHES.md`, lengkap dengan alasan dan
   penanganan sementara di sisi plugin.
3. Jangan menambal core di branch Starnet. Tambalan lokal untuk keperluan dev pribadi (misalnya fix path Windows)
   tidak boleh di-commit.

### Cara mengecek

```sh
git fetch https://github.com/paperclipai/paperclip.git master
node packages/starnet-devkit/scripts/core-diff-check.mjs --against FETCH_HEAD
```

Hasil yang diharapkan: `✓ no core edits beyond the approved P-0 streaming patch`.

## 5.2 Alur branch dan PR

- Branch utama: **`starnet/main`** (default branch fork).
- Kerja baru di branch `starnet/<topik>`, lalu PR ke `starnet/main`. PR tidak pernah dibuka ke upstream dari alur
  ini.
- Judul PR mengikuti fase, misalnya `Starnet Phase 1.3: …`.
- Body PR berisi: apa yang ditambahkan, bukti verifikasi di instance lokal (angka, bukan "sudah jalan"), hasil tes,
  dan konfirmasi `core-diff-check` hijau.
- Merge memakai merge commit untuk PR sync upstream (bukan rebase atau squash).

## 5.3 CI Starnet

Workflow `.github/workflows/starnet-ci.yml` berjalan pada PR dan push ke `starnet/**` (hanya di repo
`sigitholic/paperclip`):

1. Install dengan lockfile beku (gagal jelas kalau lockfile tidak sinkron).
2. Build plugin SDK.
3. Typecheck, test, dan build semua `packages/{plugins/,,adapters/}starnet-*`.
4. Pemeriksaan batas repo: `check-forbidden-tokens`, `check-module-boundaries`, `check-token-gates`.
5. Tes regresi P-0 di server.
6. `core-diff-check` terhadap upstream master.

Workflow upstream dimatikan lewat pengaturan Actions repo (bukan diedit). Kalau upstream menambah workflow baru,
laporan sync mencantumkannya di "New upstream workflows" untuk dimatikan dengan cara yang sama.

## 5.4 Sync upstream mingguan

Skrip `packages/starnet-devkit/scripts/upstream-sync.sh`, dijalankan oleh workflow `starnet-upstream-sync.yml` setiap
Senin 02:00 WIB atau manual:

1. Fetch `upstream/master`; berhenti kalau sudah up to date.
2. Branch `starnet/sync-YYYYMMDD`, lalu `git merge --no-ff upstream/master`.
3. Konflik `pnpm-lock.yaml` diambil dari upstream lalu diregenerasi. Konflik lain menghentikan skrip; tidak pernah
   diselesaikan dengan mengedit core.
4. Menjalankan semua pemeriksaan CI, lalu menulis laporan (commit upstream, konflik, file core, workflow baru, migrasi
   DB baru) sebagai body PR.

Setelah PR sync di-merge: restart instance lokal supaya migrasi jalan, tunggu `/api/health`, lalu jalankan
`pnpm --filter @starnet/devkit e2e`.

## 5.5 Konvensi kode Starnet

- **Mock dulu, live kemudian.** Setiap sumber data eksternal punya mode mock berlabel jelas dan server palsu di devkit.
- **Tidak ada secret di file, config, log, atau chat.** Selalu secret-ref ke company secret.
- **Tool tulis wajib memuat kata kerja tulis/destruktif** di namanya, dan dijaga `assertGatewayRisk`.
- **Status UI hanya dari state core dan event.** Tidak ada animasi atau status karangan (Virtual Office).
- **Deterministik bila bisa.** Ringkasan L1 dan agent NOC saat ini tidak memakai LLM, supaya bisa dites dan murah.
- **Tes:** tiap paket punya `test`; memory-core memakai `node:test` dengan ambang coverage (baris/fungsi 90%,
  branch 85%); alur ujung ke ujung dicek oleh E2E devkit.
- Bahasa: kode dan README paket dalam bahasa Inggris; README Starnet, dokumentasi ini, dan teks UI untuk operator dalam
  bahasa Indonesia.

## 5.6 Checklist sebelum PR

```sh
pnpm --filter "./packages/plugins/starnet-*" --filter "./packages/starnet-*" --filter "./packages/adapters/starnet-*" --workspace-concurrency=1 typecheck
pnpm --filter "./packages/plugins/starnet-*" --filter "./packages/starnet-*" --filter "./packages/adapters/starnet-*" test
pnpm --filter "./packages/plugins/starnet-*" --filter "./packages/starnet-*" --filter "./packages/adapters/starnet-*" --workspace-concurrency=1 build
pnpm --filter @starnet/devkit e2e          # butuh instance lokal yang jalan
node packages/starnet-devkit/scripts/core-diff-check.mjs --against FETCH_HEAD
```

Pastikan juga tidak ada file core yang ikut ter-commit (termasuk tambalan lokal atau perubahan line ending di
`packages/paperclip-runner`).
