# 4. Roadmap

Urutan fase mengikuti README fork (`.github/README.md`). Fase yang sudah selesai dicatat dengan PR-nya. Untuk fase yang
belum dimulai, cakupan dan kriteria selesai di bawah adalah **usulan** yang disusun dari ADR Starnet Office dan batas
Paperclip yang sudah ditemui; perlu disetujui sebelum dikerjakan.

> Roadmap ini milik Starnet. [`ROADMAP.md`](../../ROADMAP.md) di root repo adalah roadmap **Paperclip upstream**: ikut
> terbawa dari fork, diperbarui lewat sync upstream, dan tidak boleh diedit (aturan no-core-edits). Keselarasan
> keduanya dibahas di bagian [Keselarasan dengan roadmap upstream](#keselarasan-dengan-roadmap-upstream).

## Status per 3 Okt 2026

| Fase | Fokus | Status |
|---|---|---|
| 0 | Fondasi: pack ISP, Office Chat, Virtual Office, P-0, CI, devkit, sync | ✅ Selesai |
| 1 | Starnet Memory | ✅ Selesai (1.1–1.4) |
| 2 | Runtime adapter Starnet (loop, konteks, sandbox, policy, QA gate) | ✅ Selesai (isolasi baca menunggu core): NOC Engineer (LLM) menjawab lewat tool gateway (STAA-35); konteks tersuntik ✅ (STAA-52); batas langkah/token ✅ (STAA-53); QA gate ✅ (STAA-55); sandbox ✅ (STAA-57, tulis + jaringan) |
| 3 | Tier model per agent (dilebur ke Fase 2) | ✅ Peta tier, skrip validasi, template bertier, `apply-tier` |
| 4 | Pack OLT/billing + tool tulis di balik approval | ⬜ Rencana |
| 5 | Agent factory / template office | ✅ Template office sekali klik (4 office, lewat API import core). Draf roster dari prompt (ADR-003) belum |
| 6 | Multi-tenant | ⬜ Rencana (sebagian besar sudah core) |
| – | Installer Windows untuk pengguna awam | ✅ Installer ringan (paket npm + bundle Starnet siap pakai); uji di PC dengan UAC menyala masih menunggu |

## Log harian 2–3 Okt 2026

Semua commit langsung ke `starnet/main` dan di-push; CI `starnet-ci` hijau di commit terakhir.

| Waktu (WIB) | Hasil | Commit |
|---|---|---|
| 2 Okt pagi–sore | Status roadmap dan keselarasan dengan `ROADMAP.md` upstream; edit core dari commit lokal dibuang | `91cf88a62`, `cb0def6b8` |
| 2 Okt sore | Tier model, model probe, adapter `starnet_9router`, NOC Engineer (LLM), template bertier, `apply-tier` (Fase 3) | `281ffe91e`, `7463673d5`, `7f8cd2f46` |
| 2 Okt sore | Pack ISP: transport RouterOS API, banyak router MikroTik, halaman setting ringkas | `9c97f2aa0`, `1ca9a61d0`, `781e3f1f3` |
| 2 Okt malam | Pack NMS (Zabbix + LibreNMS), lihat [Pack NMS](#pack-nms--zabbix--librenms-2-okt-2026) | `3279979c4` |
| 2 Okt malam | Fase 2 selesai: context pack memory (2.2), batas langkah/token (2.1), QA gate (2.3), sandbox Codex (2.4) | `d9b82aef6`, `78a05f239`, `c10b22c6f`, `1a45facbe` |
| 2 Okt malam | Installer Windows satu langkah dari source + launcher; perbaikan untuk PC `sigit` (execution policy Restricted, Git/Node di luar PATH, timeout Docker, symlink, password Postgres lama, checkout LF) | `9914f5e11` … `13eb89837` |
| 2 Okt malam | Commit `0fa9fbbc0` sempat membawa file core; dikembalikan identik dengan upstream | `a3d1d00d1` |
| 2 Okt malam | Fase 5.1: template office sekali klik (Network/ISP, Software, Marketing, Finance), lihat [5.1](#51-template-office--2-okt-2026) | `8e10d98f5` |
| 2 Okt malam | Network Office dipasang di Starnet Demo: NOC Manager → Kepala Kantor, 3 anggota → NOC Manager, semua `paused`, adapter `starnet_9router`; routine "Laporan mingguan jaringan" (`0 8 * * 1`) `paused` | (data instance, bukan kode) |
| 3 Okt dini hari | Installer ringan menggantikan installer source sebagai default, lihat [Installer Windows](#installer-windows-3-okt-2026) | `16b1bccea`, `95dd015d4` |

Keputusan operator hari ini: konektor OLT (Fase 4) dilewati dulu; agent lama (Diag Codex, CTO, Software Developer,
NOC Engineer `process`) **tidak** di-terminate.

## Fase 0 — Fondasi ✅

| Langkah | Hasil | PR |
|---|---|---|
| Spike | Pack ISP sebagai plugin tanpa edit core: 4 tool read-only, NOC Engineer, routine, widget | [#1](https://github.com/sigitholic/paperclip/pull/1) |
| UI | Office Chat dan Virtual Office sebagai plugin UI | [#2](https://github.com/sigitholic/paperclip/pull/2) |
| P-0 | Stream bridge plugin disambung; UI live lewat SSE | [#3](https://github.com/sigitholic/paperclip/pull/3) |
| 0.2 | CI khusus Starnet; workflow upstream dimatikan di fork | [#4](https://github.com/sigitholic/paperclip/pull/4) |
| 0.3 | Sync upstream mingguan (skrip + workflow) | [#6](https://github.com/sigitholic/paperclip/pull/6) |
| 0.4 | Least privilege agent NOC; catatan timing routine | [#9](https://github.com/sigitholic/paperclip/pull/9) |
| 0.5 | Devkit: seed demo, server palsu, E2E | [#5](https://github.com/sigitholic/paperclip/pull/5) |
| Aturan | Penegakan no-core-edits (`core-diff-check`) | [#7](https://github.com/sigitholic/paperclip/pull/7) |
| Sync | Sync upstream pertama dan kedua | [#8](https://github.com/sigitholic/paperclip/pull/8), [#11](https://github.com/sigitholic/paperclip/pull/11) |

Angka terukur (mock, devkit E2E): run mulai +108 ms, meja busy +341 ms, balasan +0,9 detik, meja idle +1,2 detik;
routine manual ke run mulai p95 91 ms.

## Fase 1 — Starnet Memory ✅

| Langkah | Hasil | PR |
|---|---|---|
| 1.1 | `@starnet/memory-core`: admission, scrub secret, anti-poisoning EN/ID, L1 deterministik, bundle berbudget (65 tes, 99,6% baris) | [#10](https://github.com/sigitholic/paperclip/pull/10) |
| 1.2 | Plugin `starnet.memory`: L1, pin, context pack, tool memori, UI Memori | [#12](https://github.com/sigitholic/paperclip/pull/12) |
| 1.3 | NOC menarik context pack; E2E memory | [#13](https://github.com/sigitholic/paperclip/pull/13) |
| 1.4 | Tampilan per agent, label yang terbaca | [#15](https://github.com/sigitholic/paperclip/pull/15) |
| Docs | README Starnet berbahasa Indonesia | [#14](https://github.com/sigitholic/paperclip/pull/14) |

Hasil: context pack 665 karakter (sekitar 167 token) dibanding riwayat naif 11.906 karakter, 94,4% lebih kecil.

Sisa kecil: memori L2/L3 masih sederhana; penghematan penuh menunggu Fase 2 karena plugin tidak bisa menyuntik ke prompt.

## Kemajuan sejak 27 Sep 2026 (belum di-commit)

Hasil sesi audit dan perbaikan di instance lokal Windows (rinciannya di
[07-audit-bug-2026-09-27.md](./07-audit-bug-2026-09-27.md)):

| Hasil | Bukti |
|---|---|
| Agent LLM pertama yang jalan: adapter `codex_local` (engine ACP bawaan repo) dengan login ChatGPT dan model `gpt-6-luna` | Agent uji menyelesaikan STAA-15; penyebab gagal sebelumnya adalah model default yang tidak diizinkan paket ChatGPT Go (B-01) |
| Office Chat terhubung ke agent LLM: pesan bebas diteruskan ke agent default (role `ceo`), sapaan dijawab langsung, urutan status diperbaiki, UI memakai token tema host | 17 test plugin; STAA-16 dijawab Kepala Kantor dalam Bahasa Indonesia (OC-1) |
| Agent **Kepala Kantor** (`ceo`, Codex, `gpt-6-luna`) di Starnet Demo | Dari Office Chat, operator menyuruhnya membuat agent baru, dan agent **Software Developer** dibuat lewat alur hire core (`agent.hire_created`, melapor ke Kepala Kantor, model ikut `gpt-6-luna`) |
| Tanpa hardcode | Scan paket `starnet-*`: tidak ada path drive, IP, atau kredensial di kode produksi; host perangkat dan secret hanya lewat config plugin dan secret-ref. Beda dengan Starnet Office yang banyak hardcode |

Catatan: agent **NOC Engineer** (adapter `process`) di-terminate dari UI pada 29 Sep. Akibatnya permintaan PPPoE/router
di Office Chat sekarang jatuh ke Kepala Kantor, yang tidak punya tool pack-isp. Jalankan ulang
`setup` pack-isp atau seed demo untuk memulihkannya, sampai NOC versi LLM tersedia di Fase 2.

## Fase 2 — Runtime adapter Starnet (usulan)

**Tujuan:** agent Starnet berbasis LLM yang berjalan dengan loop terkontrol, menerima context pack secara otomatis,
dan hanya bisa bertindak lewat tool gateway.

**Kenapa paling penting:** membuka nilai Fase 1 secara penuh (konteks disuntik, bukan ditarik), dan menjadi syarat
agent NOC berbasis LLM serta tool tulis di Fase 4.

**Bentuk:** paket baru `packages/adapters/starnet-*` (path milik Starnet) sebagai adapter Paperclip.

Cakupan usulan:

1. **Loop eksekusi** observe → plan → act → evaluate → lanjut / ulang / eskalasi (Vision §3.2, LC-1), dengan batas
   langkah dan batas token per run.
2. **Konteks tersuntik:** setiap run memulai dengan `<starnet-context>` dari `starnet.memory` (ADR-012 slice C,
   ADR-014), bukan transkrip.
3. **Tool hanya lewat gateway** (ADR-001, ADR-012 butir 4); daftar tool yang terlihat agent = tool yang di-grant.
4. **Sandbox** memakai environment/sandbox provider core untuk shell/git (ADR-006), bukan host.
5. **QA gate:** issue induk tidak `done` tanpa bukti (QA + security + evidence, LC-4). Pakai dulu fitur core
   **Enforced Outcomes** (review gate, watchdog, recovery) dan **Agent Reviews and Approvals**; bangun sendiri hanya
   bagian yang tidak tercakup.
6. Agent NOC versi LLM memakai tool yang sama dengan versi deterministik.

**2.2 Konteks tersuntik — selesai 2 Okt 2026.** Adapter `starnet_9router` mengambil context pack untuk issue run dari
route agent `starnet.memory` (token run sendiri) sebelum memanggil Codex, lalu menambahkannya ke
`context.paperclipSessionHandoffMarkdown`. Kedua jalur Codex (exec dan ACP) memasukkan field itu ke setiap prompt,
termasuk sesi yang di-resume, dan mencatat ukurannya sebagai `sessionHandoffChars`. Handoff sesi milik core tetap ada
(pack ditempel di belakangnya) dan objek `context` asli tidak diubah, jadi pack tidak ikut tersimpan di snapshot run.
Best effort: plugin tidak ada, run tanpa issue, atau error = run jalan tanpa memori, dengan satu baris log alasan.
Bisa dimatikan per agent lewat toggle **Starnet Memory context** (`adapterConfig.starnetMemory: false`). Berlaku
untuk semua agent `starnet_9router` (NOC LLM, Kepala Kantor, CTO, Software Developer). Tanpa perubahan core.

Bukti STAA-52 (NOC Engineer LLM, `cx/gpt-6-luna`): log run `[starnet] memory context injected: 682 chars (~171 tok),
sections task+agent; naive history 2028 chars (~507 tok), saved 66.4%`; tanpa memanggil tool, agent mengutip bagian
"Tugas" dan "Memori agen (run sebelumnya)" dari blok `<starnet-context>`.

**2.1 Batas langkah dan token per run — selesai 2 Okt 2026.** Adapter `starnet_9router` membaca event Codex ACP di log
run: tool call awal (`acpx.tool_call` bertag `tool_call`) dihitung sebagai langkah, dan `acpx.status`/`usage_update`
(`used`) sebagai ukuran konteks sesi. Saat batas pertama terlewati, adapter menulis satu baris log alasan lalu
membatalkan run lewat sinyal yang digabung dengan sinyal stop operator; engine membatalkan turn secara kooperatif dan
memaksa berhenti setelah `graceSec`. Run dilaporkan `failed` dengan `errorCode: starnet_run_limit` dan
`resultJson.starnetRunLimit`; penanda stop operator (`executionCancellation`) dan bukti replay (`executionRecovery`)
dibuang supaya core tidak menganggapnya Stop atau me-replay run.

| Setelan adapter | Default | Catatan |
|---|---|---|
| `starnetMaxToolCalls` | 60 | NOC LLM dari template pack-isp: 20 (jawaban NOC butuh 3–6 tool call). 0 = mati |
| `starnetMaxContextTokens` | 200 000 | Jendela konteks `cx/gpt-6-luna` 258 400. 0 = mati |

Bukti STAA-53 dengan batas sementara 1: run berhenti di tool call ke-2 (`failed`, `starnet_run_limit`,
`Starnet run limit: 2 tool calls exceeds the limit of 1`); core tidak me-retry (`replay: not_authorized`) dan
memindahkan issue ke `blocked`. Setelah batas dikembalikan ke 20 dan board merekonsiliasi, run ulang sukses dan issue
`done`. Context pack run ulang memuat bagian `handoff` dari run yang dihentikan.

Temuan:

- Batas ini **bukan pengaman tool tulis.** Model mengirim beberapa tool call paralel; tiga dimulai dalam 30 ms setelah
  batas terpicu dan dua di antaranya selesai lewat gateway sebelum turn berhenti. Untuk Fase 4, pengaman tool tulis
  tetap approval gate (`require_approval`), bukan batas langkah.
- Run yang dihentikan dengan tool call yang hasilnya belum pasti diblokir core sampai board merekonsiliasi
  (`execution_reconciliation_required`): lewat UI recovery issue atau
  `POST /api/issues/:id/recovery-actions/resolve` dengan `executionReconciliation` (run id, `actionOutcome`, bukti).
  Mengubah status issue saja tidak cukup. Ini justru jalur eskalasi yang diinginkan: manusia memutuskan sebelum
  agent jalan lagi.
- Agent yang sudah ada tidak ikut berubah oleh template (reconcile core tidak memperbarui agent lama); set lewat
  `PATCH /api/agents/:id` (`adapterConfig` digabung) atau form adapter. `apply-tier` mempertahankan setelan ini.

**2.3 QA gate — selesai 2 Okt 2026.** Dibangun di atas review stage core (`issue.executionPolicy`, Enforced
Outcomes / Agent Reviews), tanpa perubahan core. Setelan adapter `starnetQaReviewer` (id agent reviewer) membuat
adapter `starnet_9router`, sebelum run, menambahkan stage `review` dengan reviewer itu ke issue run bila belum ada
(`maxReviewRounds` 2). Syaratnya: issue di-assign ke agent ini dan statusnya belum `in_review`/`done`/`cancelled`.
Setelah itu core yang menegakkan: saat executor menandai `done`, issue pindah ke `in_review` dan di-assign ke reviewer;
reviewer menyetujui dengan `done` + komentar, atau meminta revisi dengan status lain + komentar (issue kembali ke
executor). Setelah 2 ronde agent, review naik ke manusia.

Celah core: agent boleh mengubah `executionPolicy` issue-nya sendiri, jadi executor bisa menghapus stage lalu menutup
issue dalam satu PATCH, dan SDK plugin tidak bisa mengatur `executionPolicy`. Karena itu adapter memeriksa issue setelah
run: bila `done` tanpa stage reviewer di `executionState.completedStageIds`, run dilaporkan `failed` dengan
`errorCode: starnet_qa_bypassed` dan `resultJson.starnetQa`, sehingga bypass terlihat di riwayat run. Instruksi agent
juga melarang mengubah `executionPolicy`. Pemeriksaan ini mendeteksi, tidak mencegah; usulan upstream ada di
`STARNET_PATCHES.md`.

Reviewer: agent baru **QA NOC (LLM)** (`noc-qa`, role `qa`) dari pack-isp, tier standard, `starnetMaxToolCalls` 15,
heartbeat mati, profil tool read-only yang sama dengan NOC. Ia memverifikasi ulang dengan tool, lalu berkomentar
`QA OK: …` (setuju) atau `QA REVISI: …` (revisi). Seed demo membuat agent ini, mengikat profil tool, dan mengisi
`starnetQaReviewer` NOC LLM. Agent yang baru dibuat masih `paused` tanpa model; isi model (`apply-tier` atau form) lalu
resume.

Bukti STAA-55 (NOC LLM → QA NOC, keduanya `cx/gpt-6-luna`): log run executor `[starnet] QA gate: review stage added
for reviewer 2521a682…`; NOC berkomentar "Terdaftar 1 router MikroTik: default" lalu menandai selesai; issue pindah ke
`in_review` (assignee QA NOC, `executionState.status: pending`); QA NOC memanggil `mikrotik.list_routers` sendiri,
berkomentar "QA OK: … Jumlah dan nama sesuai komentar NOC", dan issue menjadi `done` dengan stage tercatat selesai.
Seluruh alur sekitar 80 detik. Catatan: core membatalkan run executor (`issue_reassigned`) saat issue berpindah ke
reviewer; itu perilaku normal dan tidak dihitung bypass. Prototipe manual STAA-54 (reviewer Kepala Kantor, model combo
`peperclip` macet) dibatalkan.

**2.4 Sandbox — selesai 2 Okt 2026.** Sebelumnya semua agent `starnet_9router` berjalan lewat Codex ACP dengan izin
`approve-all` langsung di host: shell agent punya akses penuh ke mesin. Jalur core tidak bisa dipakai tanpa patch:

- Environment remote (SSH, sandbox provider Kubernetes/E2B/Daytona, dan lain-lain) hanya untuk tipe adapter di daftar
  hardcode `REMOTE_MANAGED_ADAPTERS` (`packages/shared/src/environment-support.ts`); adapter eksternal tidak bisa
  mendaftar. Usulan upstream di `STARNET_PATCHES.md`.
- Sandbox proses lokal core (`local-process-sandbox`, bubblewrap) hanya Linux dan tidak didukung engine ACP.

Karena itu adapter memakai sandbox bawaan Codex. Setelan `starnetSandbox` (default `workspace-write`) menjalankan
engine CLI Codex memakai binary dari dependency `@openai/codex` 0.156.0, dengan `sandbox_mode="workspace-write"`, di
Windows `windows.sandbox="unelevated"` (restricted token), dan `--skip-git-repo-check` (workspace fallback agent bukan
repo git). Provider 9router diberikan lewat `-c model_providers.ninerouter.*`, karena CLI tidak membaca
`MODEL_PROVIDER`/`CODEX_CONFIG` seperti codex-acp. `extraArgs` operator yang mengubah atau mem-bypass sandbox atau
provider dibuang dan dicatat di log. `starnetSandbox: "off"` mengembalikan jalur ACP lama.

| Setelan adapter | Default | Catatan |
|---|---|---|
| `starnetSandbox` | `workspace-write` | `off` = Codex ACP, akses host penuh |
| `starnetSandboxNetwork` | mati | Mati: shell hanya menjangkau loopback (API Paperclip), bukan internet atau perangkat pelanggan. Panggilan model tidak terpengaruh |

Uji sandbox Windows langsung (`codex sandbox`, tanpa model): tulis di workspace berhasil; tulis di luar workspace
`Access is denied`; baca repo tetap bisa; dengan jaringan mati, `127.0.0.1:3100` tetap 200 sedangkan host internet
`EACCES`.

Bukti STAA-57 (NOC LLM → QA NOC): log `[starnet] sandbox: workspace-write (Codex CLI), network off (loopback only)`;
tujuh perintah shell (PowerShell) berjalan, termasuk `node …starnet-pack-isp…` (tool pack) dan panggilan REST ke API
Paperclip; `mikrotik.system_resource` mode live terjawab; menulis `C:\starnet-sandbox-probe.txt` ditolak
(`Access to the path is denied`, file tidak ada). QA NOC menyetujui (`QA OK`) dan issue `done`, jadi context pack, QA
gate, dan sandbox jalan bersama. Run pertama (STAA-56, dibatalkan) gagal karena workspace non-git sebelum
`--skip-git-repo-check` ditambahkan.

Batasan:

- Hanya **tulis dan jaringan** yang dibatasi; **baca tidak**. Agent masih bisa membaca file di luar workspace
  (misalnya `~/.paperclip`). Untuk isolasi baca, butuh environment remote core (usulan upstream) atau deploy Linux.
- Engine CLI mengabaikan sinyal abort, jadi batas tool call menghentikan pohon proses lewat PID dari `onSpawn`
  (`taskkill /T /F` di Windows, process group di POSIX). Ini teruji di unit test, belum dipicu live.
- `starnetMaxContextTokens` hanya berlaku di ACP: usage `turn.completed` CLI adalah jumlah semua request satu turn,
  bukan ukuran konteks.
- Default berlaku untuk semua agent `starnet_9router` (NOC LLM, QA NOC, Kepala Kantor, CTO, Software Developer).
  Agent yang butuh internet dari shell (misalnya `npm install`) perlu `starnetSandboxNetwork: true`.

Kriteria selesai usulan:

- E2E: pertanyaan NOC dijawab agent LLM lewat tool gateway, dengan context pack terbukti ada di prompt run.
  (Konteks di prompt: terbukti manual di STAA-52; belum otomatis di E2E devkit.)
- Tidak ada tool call di luar gateway; tool yang tidak di-grant ditolak.
- Penghematan token terukur di prompt sungguhan, bukan hanya di pack.
- `core-diff-check` tetap hijau.

Keputusan sebelum mulai:

| Keputusan | Status per 2 Okt 2026 |
|---|---|
| Model/provider default untuk dev | **Terjawab untuk dev lokal:** `codex_local` + login ChatGPT + `gpt-6-luna`. Model harus diisi eksplisit; default Codex (`gpt-6-astra`) dan `gpt-5.5` ditolak untuk paket Go, sedangkan `gpt-5.6-terra`/`gpt-5.6-luna` lolos (lihat Fase 3). Untuk produksi, pertimbangkan API key (tidak dibatasi paket) |
| Loop memakai adapter LLM yang ada atau adapter sendiri | Terbuka. Bukti sejauh ini: adapter Codex core sudah cukup untuk chat, hire agent, dan tugas sederhana. Adapter Starnet baru dibutuhkan untuk konteks tersuntik dan batas loop/token |
| Sandbox provider untuk dev lokal | **Terjawab 2 Okt:** sandbox bawaan Codex (`workspace-write`) lewat adapter `starnet_9router` (2.4). Provider core belum bisa dipakai adapter eksternal |
| Ukuran mutu agent | Baru: pakai **Agent evals & feedback** core untuk membandingkan NOC deterministik vs NOC LLM |

## Fase 3 — Tier model per agent (dilebur ke Fase 2)

**Tujuan:** tier `fast | standard | reasoning` per agent (ADR-005) tanpa router runtime dan tanpa mengubah core.

**Alasan desain.** Upstream PR #12683 (1 Sep 2026) menghapus `modelProfiles`/model murah. Core kini hanya punya
satu jalur pemilihan model: `adapterConfig` milik agent. Router runtime Starnet akan melawan arah itu dan menyentuh
core. Jadi tier diselesaikan **saat agent dibuat**, bukan saat run.

| Langkah | Isi | Status |
|---|---|---|
| 3.1 | Peta tier di `@starnet/pack-kit` (`src/model-tiers.ts`): `DEFAULT_CODEX_TIERS` dan `tierAdapterConfig(tier)` → `{ model, modelReasoningEffort }` | ✅ |
| 3.2 | Skrip validasi `pnpm --filter @starnet/devkit check:models -- --company <nama> --yes`: satu run kecil per model lewat agent probe sementara; kegagalan dijelaskan dari log Codex sendiri | ✅ |
| 3.3 | Template agent mendeklarasikan tier lewat `tierTemplate(tier)` (`adapterConfig.starnetTier`, status `paused`); `pnpm --filter @starnet/devkit apply-tier` mengisi model, URL 9router, dan secret per company lalu me-resume agent. Plugin SDK tidak punya API untuk mengubah `adapterConfig` agent setelah dibuat, jadi tier tidak bisa diterapkan dari `setup` | ✅ |
| 3.4 | Override per issue lewat `assigneeAdapterOverrides.adapterConfig` (sudah ada di core) | ⏸ Ditunda sampai ada kebutuhan nyata |

**Kenapa probe memakai run sungguhan.** Endpoint `test-environment` adapter Codex melewati hello probe saat engine
ACP aktif, dan daftar model Codex (`models_cache.json`) memuat model yang ternyata ditolak. Hanya run sungguhan yang
membuktikan akses.

**Hasil probe pertama (2 Okt 2026, ChatGPT Go, Starnet Demo):**

| Model | Hasil |
|---|---|
| `gpt-6-luna` | ✅ lolos (STAA-22) |
| `gpt-5.6-terra` | ✅ lolos (STAA-23) |
| `gpt-5.6-luna` | ✅ lolos (STAA-24) |
| `gpt-5.5` | ❌ `404 model does not exist or you do not have access` (STAA-25) |

Peta default tetap memakai `gpt-6-luna` untuk ketiga tier, dibedakan lewat `modelReasoningEffort` (`low`/`medium`/`high`).
Model `gpt-5.6-*` kini terbukti tersedia sebagai alternatif bila perlu tier yang lebih murah atau lebih kuat.

**Gateway 9router (2 Okt 2026).** Peta tier bisa mengarahkan `codex_local` ke gateway yang kompatibel dengan OpenAI,
misalnya [9router](https://github.com/decolua/9router), tanpa adapter baru dan tanpa mengubah core. `codex-acp` yang
dibundel membaca `MODEL_PROVIDER` dan `CODEX_CONFIG` dari environment, jadi `ninerouterTiers({ baseUrl, models })` di
`@starnet/pack-kit` cukup mengisi `adapterConfig.env` agent (API key sebagai `secret_ref`, secret
`starnet-9router-api-key`). Validasi: `check:models --provider 9router --base-url <url>`.
Untuk pengaturan lewat UI ada adapter eksternal `@starnet/adapter-9router` (`packages/adapters/starnet-9router`, type
`starnet_9router`): dipasang dari Instance settings → Adapters → Install Adapter (path lokal paket), lalu muncul sebagai
"Starnet 9router" di dropdown adapter agent dengan field "9router URL" dan "Model / combo"; API key diisi di tab
Secrets & variables agent sebagai `NINEROUTER_API_KEY`. Adapter ini membungkus eksekusi Codex ACP core (tanpa fork).
Keterbatasan karena core mengenali beberapa perilaku hanya untuk type `codex_local`: MCP gateway terkelola, persiapan
git workspace, dan resume sesi tidak berlaku untuk `starnet_9router`; tool plugin tetap tersedia lewat runtime tools. Catatan risiko: jangan hubungkan
login langganan (ChatGPT/Claude/Copilot) ke 9router karena berisiko melanggar ToS provider; semua prompt agent (termasuk
data pelanggan ISP) melewati gateway; jalankan 9router dengan `REQUIRE_API_KEY=true` dan ganti password dashboard default.

**NOC Engineer (LLM), 2 Okt 2026.** Pack-isp kini membuat agent kedua `noc-engineer-llm` (adapter `starnet_9router`,
tier `standard`) di samping NOC deterministik, yang tetap memegang routine harian. Temuan dari uji di Starnet Demo:

| Temuan | Akibat |
|---|---|
| Combo 9router `peperclip` (Claude lewat Vertex) gagal dengan `acpx_turn_failed` (2/2 run NOC; sesekali juga di Kepala Kantor), tanpa jejak di log Codex dan tanpa provider trace (`trace_channel_missing:rust_native`) | Untuk agent Codex ACP pakai model `cx/*` (format Responses asli). `cx/gpt-6-luna` lolos semua run |
| Tool plugin hanya dikirim sebagai MCP ke `codex_local` (`MANAGED_MCP_LOCAL_ADAPTERS` di core); adapter eksternal hanya mendapat runtime tools koneksi | NOC LLM memanggil tool lewat `agent/pack-tool.mjs` (REST tool gateway, token run, grant dan policy tetap berlaku). Argumen `key=value` karena PowerShell merusak kutip JSON |
| `permissions.pluginTools` di manifest tidak dibaca server; izin datang dari tool profile | Seed demo mem-bind profile "Starnet NOC (read-only)" ke kedua NOC |
| Instruksi agent terkelola tidak ikut diperbarui oleh `reconcile` | Perbarui lewat `PUT /agents/:id/instructions-bundle/file` atau reset agent lalu `apply-tier` |

Hasil: STAA-35 dijawab NOC LLM ("PPPoE aktif: 137 sesi. CPU router: 23%, memori: 41%. Data MOCK") lewat tiga panggilan
tool gateway, lalu issue ditandai `done`.

**Kriteria selesai:**

- Tidak ada nama model yang di-hardcode di template atau plugin; semua lewat peta tier.
- `check:models` lolos untuk semua model di peta tier pada akun target.
- Ganti provider atau paket = ubah satu peta tier.
- `core-diff-check` tetap hijau (tidak ada file core yang berubah).

## Pack NMS — Zabbix + LibreNMS (2 Okt 2026)

Dibuat sebagai plugin `starnet.pack-nms`, bukan connector katalog Apps, karena connector Apps berarti mengubah
`packages/shared` (core). Detail di [README pack-nms](../plugins/starnet-pack-nms/README.md).

| Hasil | Bukti |
|---|---|
| 3 tool read-only (problem aktif, status host, daftar source), multi-source, satu source gagal tidak menjatuhkan yang lain | 18 test (server Zabbix JSON-RPC dan LibreNMS palsu); tool dipanggil lewat tool gateway di Starnet Demo |
| Webhook alert → issue NOC: verifikasi HMAC (Zabbix) atau token (LibreNMS), dedupe, tutup otomatis saat pulih, filter severity, batas issue per jam | E2E di Starnet Demo: signature palsu ditolak, problem jadi STAA-49 (high), kiriman ulang tidak menggandakan, status pulih menutup STAA-49 |
| NOC harian memuat bagian NMS bila tool NMS di-grant; data MOCK tidak dihitung sebagai alert | STAA-51 |
| `fetchJson` pack-kit mendukung POST JSON (untuk JSON-RPC) | Test pack-kit |

Belum: uji terhadap server Zabbix/LibreNMS nyata (butuh URL dan token read-only yang disimpan sebagai company secret),
dan URL webhook publik untuk instance yang bisa dijangkau NMS.

## Installer Windows (3 Okt 2026)

Installer dari source (Git, Docker, Rust, Build Tools, pnpm) terlalu rapuh untuk pengguna awam: di PC `sigit` gagal
berturut-turut karena execution policy, symlink, password Postgres lama, CRLF, dan sisa schema database
(`relation "agent_runtime_state" already exists`). Diganti dengan installer ringan; yang lama tetap ada untuk developer
(`install-dev.ps1`, `start-dev.ps1`).

| Bagian | Isi |
|---|---|
| `packages/starnet-installer/install.ps1` | Node.js 24 portable (zip resmi, cek SHA-256), `paperclipai` dari npm dengan versi terkunci (database Postgres bawaan), bundle Starnet dari Release `starnet-bundle`, shortcut desktop. Semua di `%LOCALAPPDATA%\StarnetOffice`; data terpisah dari `~/.paperclip` |
| `packages/starnet-installer/start.ps1` | Start pertama `onboard --yes`, berikutnya `run`; memasang plugin dan adapter yang belum ada lewat API lokal; membuka browser |
| `packages/starnet-devkit/scripts/release-bundle.mjs` | Menyusun bundle: 6 plugin (dist + `agent/` + `migrations/`, tanpa sourcemap) dan adapter `starnet_9router` dibundel esbuild jadi satu file. Versi `paperclipai` dikunci di sini (`2026.1001.0`) |
| `.github/workflows/starnet-release.yml` | Membangun dan menerbitkan `starnet-bundle.zip` (±1,3 MB) ke Release bergulir `starnet-bundle` setiap plugin/adapter berubah |

Temuan teknis:

- Adapter diletakkan di `app\starnet\` supaya memakai `@paperclipai/adapter-utils`, `adapter-codex-local`, dan
  `@openai/codex` yang sudah ikut terpasang bersama `paperclipai` (tanpa salinan kedua sekitar 900 MB).
- Database bawaan tidak bisa jalan dengan token Administrator. Bila UAC mati, installer memakai Postgres Docker
  (container `starnet-office-pg`, port 54331); bila dijalankan "Run as administrator" dengan UAC menyala, installer
  meminta dijalankan ulang di PowerShell biasa.
- Tambalan lokal `plugin-loader.ts` (#7) tidak diperlukan di paket npm, karena loader tsx tidak ada di sana.
- Patch P-0 (stream bridge) belum ada di paket npm, jadi Virtual Office dan Office Chat memakai polling.

| Uji | Hasil |
|---|---|
| Install penuh di laptop dev (UAC mati, jalur Docker), port uji 3199 | Selesai sekitar 3 menit (383 paket npm) |
| Start pertama | Migrasi database sekitar 4 menit; 6/6 plugin `ready`; adapter `starnet_9router` terdaftar; UI tampil (wizard company pertama) |
| Release dari CI | `starnet-release` sukses; zip bisa diunduh dan diekstrak `tar` bawaan Windows |

Belum: uji di PC dengan UAC menyala (jalur database bawaan), yaitu PC `sigit`.

## Fase 4 — Pack OLT/billing + tool tulis (usulan)

**Syarat:** Fase 2 selesai, dan salah satu dari: field `risk` eksplisit diterima upstream (kandidat PR 1 di
`STARNET_PATCHES.md`), atau aturan penamaan + `assertGatewayRisk` dianggap cukup.

Cakupan usulan:

1. Pack OLT (ZTE) read-only dulu, mengikuti pola pack-isp (mock → live, secret-ref, timeout).
2. Tool tulis pertama, misalnya `mikrotik.remove_active_session` atau `mikrotik.apply_reboot`, dengan:
   profile terpisah, tool policy `require_approval` untuk `write/destructive`, dan `allowWrites: true` per company.
3. Default untuk perangkat live: selalu minta approval (ADR-011: kritis tetap "always").
4. Pack billing mengikuti setelah pola tulis terbukti aman.

## Fase 5 — Agent factory / template office

**Tujuan:** "Install office" (Network/ISP, Software, Marketing, Finance) tanpa prompt engineering (ADR-007), dan draf
roster dari prompt (ADR-003) yang tetap tidak memberi izin tool.

### 5.1 Template office ✅ (2 Okt 2026)

Plugin `starnet.office-templates`, halaman **Install Office** di sidebar. Detail di
[README plugin](../plugins/starnet-office-templates/README.md).

Kenapa API import (`/imports/preview` + `/imports/apply`) dan bukan teams catalog core:

- Katalog core hanya bisa diganti seluruhnya lewat `PAPERCLIP_TEAMS_CATALOG_DIR`. Plugin tidak bisa menambah team ke
  katalog itu.
- Install lewat katalog memaksa adapter default (`claude_local`), sedangkan import menghormati adapter yang dipilih.
  Ini penting untuk `starnet_9router` dan `codex_local`.
- Halaman katalog core belum dipasang di navigasi UI.
- Managed agent plugin SDK tidak punya `reportsTo`, jadi org chart tidak bisa dibentuk.

Format paketnya tetap `agentcompanies/v1` yang sama dengan katalog. Template bisa dipindah ke teams catalog bila
keterbatasan di atas hilang di upstream.

| Hasil | Bukti |
|---|---|
| 4 office: kepala + anggota, project, routine terjadwal WIB | Uji langsung ke API import di company sementara: 17 agent dibuat, 0 warning, 0 error; company dihapus setelahnya |
| Draf, bukan izin: agent dan routine **dijeda**, `canCreateAgents/canCreateSkills: false`, tanpa tool profile, heartbeat timer mati | Uji langsung: status `paused`, routine `paused` dengan trigger `0 8 * * 1 Asia/Jakarta` dst. |
| Kepala office melapor ke agent yang dipilih (default CEO), anggota ke kepala | Uji langsung: NOC Manager → Boss (ceo), 3 anggota → NOC Manager |
| Pasang ulang tidak menggandakan (`collisionStrategy: skip`) | Uji langsung: apply kedua → semua `skipped`, jumlah agent tetap |
| Mesin AI disalin dari agent pilihan; secret ref tetap, nilai yang disensor host dibuang dan dilaporkan | 11 unit test; pratinjau di UI Starnet Demo memakai NOC Engineer (LLM) |

Belum: draf roster dari prompt (ADR-003), dan usulan tool profile per office (sekarang board memberi izin manual).

## Fase 6 — Multi-tenant

Company Paperclip sudah menjadi batas tenant. Sisa pekerjaan kemungkinan hanya: isolasi config dan state plugin
Starnet per company (sudah dilakukan: config, state, dan memory per company), serta uji penetrasi lintas company untuk
route plugin. Fase ini sebaiknya dilebur ke kriteria selesai fase lain, bukan fase terpisah.

## Keselarasan dengan roadmap upstream

Dicek terhadap [`ROADMAP.md`](../../ROADMAP.md) per 2 Okt 2026. Prinsipnya: jangan membangun ulang yang sudah ada di
core, dan jangan bersaing dengan fitur yang sedang direncanakan upstream.

**Irisan dengan rencana upstream yang belum dikerjakan (⚪):**

| Upstream | Bagian Starnet | Sikap |
|---|---|---|
| CEO Chat: ngobrol dengan agent pimpinan, tapi hasilnya tetap plan/issue/approval | Office Chat (pesan bebas ke agent `ceo`) | Desain sudah sejalan (chat menghasilkan issue). Kalau upstream merilis CEO Chat, Office Chat dipersempit menjadi lapisan routing domain ISP di atasnya, bukan chat kedua |
| Memory / Knowledge | Fase 1 Starnet Memory, pertanyaan terbuka #1 (RAG/SOP) | Plugin tetap tipis (admission, context pack hemat token). Kalau memory core muncul, plugin menjadi penyedia isi, bukan penyimpanan kedua |
| Work Queues (support, triage, intake) | Alert NOC dan keluhan pelanggan (belum ada) | Jangan bangun antrian sendiri; tunggu atau ikuti upstream |
| Self-Organization | Fase 5 Agent factory | Template office memakai format `agentcompanies/v1` dan API import core (bukan katalog sendiri). Ikuti fitur ini untuk usulan perubahan struktur |
| Connected Apps | Integrasi perangkat di pack-isp | Integrasi perangkat ISP tetap di pack; integrasi SaaS umum ikut Connected Apps |

**Fitur upstream yang sudah selesai (✅) dan dipakai Starnet:** plugin system (dasar semua paket Starnet), MCP Tool
Gateway & Apps dan Secrets Manager (tool dan kredensial pack-isp), Scheduled Routines (routine NOC), Activity log,
Self-healing runs (retry run yang gagal), alur hire agent (dipakai Kepala Kantor), serta Enforced Outcomes dan
Agent Reviews (review stage untuk QA gate Fase 2).

**Fitur upstream selesai yang belum dipakai tapi relevan:** Cloud / Sandbox agents (isolasi baca penuh; belum bisa dipakai adapter eksternal, lihat 2.4), Agent evals (mutu NOC LLM), Deep Planning (rencana sebelum tool tulis
Fase 4), dan Cloud deployments 🟡 (memperkuat keputusan Fase 6 dilebur ke fase lain).

## Pertanyaan terbuka

| # | Pertanyaan | Kenapa penting |
|---|---|---|
| 1 | Knowledge base / RAG (LightRAG, SOP, runbook): dipindah, diganti skill/dokumen core, atau ditinggal? | Agent NOC berbasis LLM butuh SOP |
| 2 | ADR-015 (durable handoff) dan context engine slice C: cukup dipetakan ke sub-issue + context pack, atau butuh plugin sendiri? | Menentukan cakupan Fase 2 |
| 3 | Approve once vs always: usul ke upstream atau dibangun di plugin? | UX approval untuk tool tulis |
| 4 | ~~MCP propose → register: pakai fitur MCP core atau alur sendiri?~~ **Terjawab:** pakai MCP Tool Gateway & Apps core (sudah ✅ di upstream) | Cara menambah integrasi baru |
| 5 | Session per tab project dan agent pair: masih dibutuhkan di model issue Paperclip? | Cakupan Office Chat berikutnya |
| 6 | Windows native: tetap tidak didukung (WSL2), atau fix path Windows diusulkan ke upstream? Data dari audit: Windows native **bisa dipakai** dengan Postgres Docker, Git Bash sebagai script-shell, dan satu tambalan lokal `plugin-loader.ts`; sisa masalahnya terdaftar sebagai kandidat PR upstream (B-02, M-01, M-03, M-05). **Sebagian terjawab 3 Okt:** pengguna awam memakai installer ringan (paket npm, tanpa build); masalah build dari source tetap kandidat PR upstream (#7, #11 di `STARNET_PATCHES.md`) | Pengalaman developer di Windows |
| 7 | Dokumen "Starnet implementation plan" asli: masih ada salinannya? | Sumber kebenaran roadmap ini |

## Pekerjaan kecil yang terbuka

- ~~Commit perubahan yang belum di-commit dalam satu PR: perbaikan Office Chat (OC-1), dokumen `packages/starnet-docs/`,
  `demo-seed.mjs`, dan `STARNET_PATCHES.md`.~~ **Selesai 2 Okt.** Tambalan lokal `server/src/services/plugin-loader.ts`
  tetap tidak di-commit.
- ~~Pulihkan agent NOC Engineer di Starnet Demo (di-terminate 29 Sep).~~ **Selesai 2 Okt:** seed demo membuat NOC
  baru lewat `setup` pack-isp; `setup` kini juga menautkan ulang routine "Daily PPPoE check" bila routine masih menunjuk
  agent lama (sebelumnya routine tertinggal `paused` pada agent yang di-terminate). Cek harian STAA-27 selesai oleh NOC baru.
- ~~Template agent Starnet memakai tier dari `@starnet/pack-kit` (Fase 3.3).~~ **Selesai 2 Okt** (`tierTemplate`, `apply-tier`).
- ~~Catat `check:models` dan `apply-tier` di [06-pengembangan-lokal.md](./06-pengembangan-lokal.md).~~ **Selesai 2 Okt.**
- ~~NOC LLM berikutnya: context pack `starnet.memory` di awal run.~~ **Selesai 2 Okt** (disuntik adapter
  `starnet_9router`, STAA-52). ~~Batas loop/token per run.~~ **Selesai 2 Okt** (STAA-53). ~~QA gate.~~ **Selesai 2 Okt** (STAA-55, agent QA NOC). ~~Sandbox.~~ **Selesai 2 Okt** (STAA-57, sandbox Codex
  `workspace-write`).
- Kandidat PR upstream: managed MCP gateway untuk adapter eksternal yang membungkus Codex (saat ini hanya `codex_local`).
- ~~Perbarui bagian "Status rencana" di `.github/README.md`.~~ **Selesai 2 Okt** (Memory, tier, Pack NMS, Pack ISP
  multi-router; tabel path memuat `starnet-pack-nms`).
- ~~Commit perbaikan Windows untuk `packages/starnet-devkit/scripts/demo-seed.mjs` dan catatan kandidat PR upstream 7.~~
  **Selesai** (guard `pathToFileURL`, kandidat 7 di `STARNET_PATCHES.md`).
- ~~README devkit masih menyebut default branch fork `master`.~~ **Selesai 2 Okt.** Masih terbuka: secret
  `STARNET_SYNC_TOKEN` disarankan agar PR sync memicu CI dan bisa menyentuh `.github/workflows/**`.
- Live test Pack NMS terhadap Zabbix/LibreNMS nyata (ditunda; butuh URL + token read-only).
- Uji installer ringan di PC `sigit` (UAC menyala, database bawaan).
- Network Office di Starnet Demo: board memberi izin tool dan me-resume agent serta routine.
- Opsional, hanya bila operator setuju: terminate agent lama yang tidak dipakai (Diag Codex, CTO, Software Developer).
- Fase 4 (konektor OLT, tool tulis MikroTik di balik approval) dan draf roster dari prompt (ADR-003).
