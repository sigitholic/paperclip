# 1. Latar belakang dan keputusan

## 1.1 Apa yang ingin dibangun

Visi produk tidak berubah sejak generasi pertama (sumber: `docs/architecture/starnet-office-vision.md` di Starnet-ofice):

> **Multi-tenant AI Agent Operating System** (control plane + agent plane), bukan chatbot ber-dashboard.
> Virtual Office hanya lapisan visualisasi.

Pengguna membuat "kantor" berisi agent AI per domain, misalnya:

- **Network Office (ISP/NOC):** NOC Manager, Network Engineer, MikroTik Agent, ZTE OLT Agent, Network QA
- **Software Office:** Product, Architect, Backend, Frontend, QA
- **Marketing Office** dan **Finance Office**

Agent bekerja lewat task, memanggil tool sungguhan (misalnya cek PPPoE di MikroTik lewat API), dan setiap aksi berisiko
melewati izin, penilaian risiko, dan approval manusia.

Delapan lapisan wajib dari visi itu: **Agent Factory, Agent Runtime, Tool Runtime, Sandbox, Context Engine, Model
Router, Memory + Knowledge, Human Control Plane**, ditambah Agent Chat (human ↔ agent ↔ agent).

Enam invariant produk yang tetap berlaku di generasi kedua:

1. Skill ≠ permission.
2. Factory menghasilkan draf; manusia dan policy yang memberi izin.
3. Aksi ke produksi hanya lewat approval.
4. Virtual Office tidak menjadi sumber kebenaran (system of record).
5. Isolasi tenant wajib di setiap query.
6. Konteks minimal demi efisiensi token, bukan dump repo, database, atau chat.

## 1.2 Generasi pertama: Starnet Office (StarClaw)

Repo: `sigitholic/Starnet-ofice` (privat), nama kode **StarClaw AI Office**. Dibangun dari nol sebagai monorepo:

| Bagian | Teknologi |
|---|---|
| `apps/api` | Fastify REST + SSE (port 4000) |
| `apps/worker` | Consumer BullMQ untuk agent, tool, dan knowledge |
| `apps/web` | Next.js dashboard + virtual office (port 3000) |
| `apps/realtime` | SSE/WebSocket terpisah (port 4100) |
| `packages/database` | Prisma + PostgreSQL (RLS, pgvector) |
| `packages/runtime`, `ai`, `tools` | Orchestrator, LLM abstraction dan model router, Tool SDK |
| Pendukung | Redis, MinIO (opsional), LightRAG untuk knowledge (opsional) |

Yang sempat dibangun sangat banyak: langkah 0–29 di `docs/implementation-plan.md` (auth, RBAC, RLS, task engine,
discussion, agent run, tool execution, approval, artifact, memory, audit), jalur lifecycle LC-1 sampai LC-6, 15 ADR
(tool pipeline, approval, capability extension, memory anti-poisoning, model router, sandbox, template, control plane,
agent chat, office channel, office initiative, lifecycle, session lane, memory v1, durable handoff), Workspace IDE,
knowledge LightRAG, marketplace template, dan lain-lain.

### Pola masalah yang tercatat di dokumen Starnet-ofice

Ini fakta dari dokumen audit dan rencana di repo lama, bukan tafsiran:

- **Rombak berulang pada lapisan control plane.** Audit 20 Sep (`audit-combined-priorities-2026-09-20.md`) mencatat
  item P0 "product broken / unsafe": koridor finish (QA → approve/reject → deploy) tidak ada di UI, tombol Reject
  approval tidak ada, RBAC chat terlalu longgar, dan jalur konfirmasi yang saling bertentangan. Dua hari kemudian ada
  rombak lagi (`rombak-control-agent-plane-2026-09-22.md`) untuk menyamakan session, koridor rilis, dan approval.
- **Balapan eksekusi.** Beberapa run dalam session yang sama bisa berlomba menulis state task dan workspace, sehingga
  perlu lock per session di Redis (ADR-013).
- **Token bloat.** Office chat pernah menyuntikkan sampai 24 × 800 karakter transkrip ke setiap balasan agent
  (ADR-014), sehingga perlu memory L1 dan context engine (slice C).
- **Kematangan runtime parsial.** Audit efisiensi 15 Sep mencatat context resolver, verify-before-continue, dan
  eskalasi model masih parsial.

## 1.3 Keputusan: pindah ke fork Paperclip

Keputusan: **semua kemampuan Starnet Office dipindahkan ke fork Paperclip**, dibangun sebagai plugin dan paket baru.
Repo lama tidak dikembangkan lagi sebagai produk; repo itu menjadi referensi desain (visi, ADR, pelajaran).

### Kenapa Paperclip (rekonstruksi)

Catatan tertulis tentang alasan keputusan ini tidak ditemukan di kedua repo. Alasan di bawah direkonstruksi dari
pola masalah di atas dan dari apa yang sudah disediakan Paperclip:

| Yang dulu dibangun sendiri di StarClaw | Yang sudah disediakan core Paperclip |
|---|---|
| Organization, RBAC, RLS, undangan user | Company sebagai unit utama, batas company dijaga di setiap route; board vs agent auth |
| Task engine, dependency, assignment | Issue dengan identifier, parent/sub-issue, blocker, single assignee, checkout atomik |
| Approval, audit log | Approval gate untuk aksi yang diatur, activity log untuk setiap mutasi |
| Budget per organisasi | Budget dengan hard-stop dan auto-pause |
| Tool pipeline (permission → risk → approval) | Tool gateway deny-by-default, tool profile, penilaian risiko, action request untuk approval |
| Kredensial terenkripsi | Company secrets dengan secret-ref yang di-bind ke plugin |
| Routine, scheduler | Routine dengan cron dan catch-up policy |
| Agent runtime per role | Adapter (Claude, Codex, Cursor, process, HTTP, dan lain-lain) dan heartbeat |
| Realtime SSE | Event domain untuk plugin dan stream bridge (setelah patch P-0) |
| UI dashboard | UI board lengkap, ditambah slot UI untuk plugin |

Dengan pindah, tenaga tim bisa fokus pada **nilai domain Starnet** (ISP/NOC, office chat, memory, runtime), bukan
membangun ulang dan merombak control plane. Upstream Paperclip juga aktif; perbaikannya masuk ke fork lewat sync
mingguan.

### Harga yang dibayar

- **Tunduk pada model Paperclip.** Konsep Starnet harus dipetakan ke primitive Paperclip (lihat
  [peta migrasi](./03-peta-migrasi.md)). Beberapa hal tidak bisa dilakukan plugin, misalnya menyuntikkan teks ke prompt
  adapter lain.
- **Batasan host.** Contoh nyata: slot `detailTab` agent tidak dirender, issue buatan plugin tidak otomatis
  dibangunkan, dan stream bridge plugin tidak tersambung sampai kami menambal P-0.
- **Disiplin no-core-edits.** Setiap kebutuhan yang menyentuh core harus menjadi usulan PR upstream, bukan tambalan
  lokal.

## 1.4 Aturan keras (27 Sep 2026)

Ditetapkan oleh Sigit dan ditegakkan otomatis oleh CI:

1. Kerja Starnet **hanya menambah file** di path milik Starnet: `packages/plugins/starnet-*`,
   `packages/adapters/starnet-*`, `packages/starnet-*`, `.github/workflows/starnet-*.yml`, `.github/README.md`,
   `STARNET_PATCHES.md`, ditambah entri `pnpm-lock.yaml` untuk paket kami.
2. **Tidak ada file upstream yang diedit**, termasuk workflow upstream.
3. Satu-satunya pengecualian: **patch P-0** (stream bridge plugin, 4 file di `server/`). Menambah pengecualian baru
   butuh persetujuan eksplisit.
4. Perubahan dari upstream masuk lewat **merge** mingguan (bukan rebase), supaya riwayat fork utuh.

Detail penegakan dan alur kerja ada di [Aturan kerja](./05-aturan-kerja.md).

## 1.5 Garis waktu

| Tanggal | Peristiwa |
|---|---|
| s.d. 22 Sep 2026 | Pengembangan Starnet Office: langkah 0–29, LC-1..6, ADR-001..015, audit, dan dua rombak besar |
| 26–27 Sep 2026 | Validation spike di fork Paperclip: pack ISP sebagai plugin tanpa edit core ([PR #1](https://github.com/sigitholic/paperclip/pull/1)) |
| 27 Sep 2026 | Fase 0 selesai (PR #2–#9); aturan no-core-edits ditegakkan ([PR #7](https://github.com/sigitholic/paperclip/pull/7)) |
| 27 Sep 2026 | Fase 1 Starnet Memory selesai (PR #10, #12, #13, #15); README Starnet ([PR #14](https://github.com/sigitholic/paperclip/pull/14)); sync upstream ([PR #11](https://github.com/sigitholic/paperclip/pull/11)) |
