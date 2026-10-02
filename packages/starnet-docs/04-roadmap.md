# 4. Roadmap

Urutan fase mengikuti README fork (`.github/README.md`). Fase yang sudah selesai dicatat dengan PR-nya. Untuk fase yang
belum dimulai, cakupan dan kriteria selesai di bawah adalah **usulan** yang disusun dari ADR Starnet Office dan batas
Paperclip yang sudah ditemui; perlu disetujui sebelum dikerjakan.

> Roadmap ini milik Starnet. [`ROADMAP.md`](../../ROADMAP.md) di root repo adalah roadmap **Paperclip upstream**: ikut
> terbawa dari fork, diperbarui lewat sync upstream, dan tidak boleh diedit (aturan no-core-edits). Keselarasan
> keduanya dibahas di bagian [Keselarasan dengan roadmap upstream](#keselarasan-dengan-roadmap-upstream).

## Status per 2 Okt 2026

| Fase | Fokus | Status |
|---|---|---|
| 0 | Fondasi: pack ISP, Office Chat, Virtual Office, P-0, CI, devkit, sync | ✅ Selesai |
| 1 | Starnet Memory | ✅ Selesai (1.1–1.4) |
| 2 | Runtime adapter Starnet (loop, konteks, sandbox, policy, QA gate) | 🟡 Sebagian: agent LLM sudah jalan lewat adapter Codex core; adapter Starnet sendiri belum |
| 3 | Tier model per agent (dilebur ke Fase 2) | 🟡 Peta tier + skrip validasi selesai; template pack belum |
| 4 | Pack OLT/billing + tool tulis di balik approval | ⬜ Rencana |
| 5 | Agent factory / template office | ⬜ Rencana |
| 6 | Multi-tenant | ⬜ Rencana (sebagian besar sudah core) |

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

Kriteria selesai usulan:

- E2E: pertanyaan NOC dijawab agent LLM lewat tool gateway, dengan context pack terbukti ada di prompt run.
- Tidak ada tool call di luar gateway; tool yang tidak di-grant ditolak.
- Penghematan token terukur di prompt sungguhan, bukan hanya di pack.
- `core-diff-check` tetap hijau.

Keputusan sebelum mulai:

| Keputusan | Status per 2 Okt 2026 |
|---|---|
| Model/provider default untuk dev | **Terjawab untuk dev lokal:** `codex_local` + login ChatGPT + `gpt-6-luna`. Model harus diisi eksplisit; default Codex (`gpt-6-astra`) dan `gpt-5.5` ditolak untuk paket Go, sedangkan `gpt-5.6-terra`/`gpt-5.6-luna` lolos (lihat Fase 3). Untuk produksi, pertimbangkan API key (tidak dibatasi paket) |
| Loop memakai adapter LLM yang ada atau adapter sendiri | Terbuka. Bukti sejauh ini: adapter Codex core sudah cukup untuk chat, hire agent, dan tugas sederhana. Adapter Starnet baru dibutuhkan untuk konteks tersuntik dan batas loop/token |
| Sandbox provider untuk dev lokal | Terbuka. Core sudah menyediakan banyak provider (Cloud / Sandbox agents) |
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
| 3.3 | Template agent di pack mendeklarasikan `tier`; `setup` pack mengubahnya menjadi `adapterConfig` lewat `tierAdapterConfig` | ⬜ Bersamaan dengan pemulihan NOC Engineer |
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

**Kriteria selesai:**

- Tidak ada nama model yang di-hardcode di template atau plugin; semua lewat peta tier.
- `check:models` lolos untuk semua model di peta tier pada akun target.
- Ganti provider atau paket = ubah satu peta tier.
- `core-diff-check` tetap hijau (tidak ada file core yang berubah).

## Fase 4 — Pack OLT/billing + tool tulis (usulan)

**Syarat:** Fase 2 selesai, dan salah satu dari: field `risk` eksplisit diterima upstream (kandidat PR 1 di
`STARNET_PATCHES.md`), atau aturan penamaan + `assertGatewayRisk` dianggap cukup.

Cakupan usulan:

1. Pack OLT (ZTE) read-only dulu, mengikuti pola pack-isp (mock → live, secret-ref, timeout).
2. Tool tulis pertama, misalnya `mikrotik.remove_active_session` atau `mikrotik.apply_reboot`, dengan:
   profile terpisah, tool policy `require_approval` untuk `write/destructive`, dan `allowWrites: true` per company.
3. Default untuk perangkat live: selalu minta approval (ADR-011: kritis tetap "always").
4. Pack billing mengikuti setelah pola tulis terbukti aman.

## Fase 5 — Agent factory / template office (usulan)

**Tujuan:** "Install office" (Network/ISP, Software, Marketing, Finance) tanpa prompt engineering (ADR-007), dan draf
roster dari prompt (ADR-003) yang tetap tidak memberi izin tool.

Arah: gunakan teams catalog core (`@paperclipai/teams-catalog`) dan skill `company-creator` sebagai dasar, bukan
katalog sendiri. Pack Starnet menyediakan agent, routine, dan usulan tool profile; board tetap yang memberi izin.

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
| Self-Organization | Fase 5 Agent factory | Sudah memakai teams catalog core. Ikuti fitur ini untuk usulan perubahan struktur |
| Connected Apps | Integrasi perangkat di pack-isp | Integrasi perangkat ISP tetap di pack; integrasi SaaS umum ikut Connected Apps |

**Fitur upstream yang sudah selesai (✅) dan dipakai Starnet:** plugin system (dasar semua paket Starnet), MCP Tool
Gateway & Apps dan Secrets Manager (tool dan kredensial pack-isp), Scheduled Routines (routine NOC), Activity log,
Self-healing runs (retry run yang gagal), dan alur hire agent (dipakai Kepala Kantor).

**Fitur upstream selesai yang belum dipakai tapi relevan:** Enforced Outcomes dan Agent Reviews (QA gate Fase 2),
Cloud / Sandbox agents (sandbox Fase 2), Agent evals (mutu NOC LLM), Deep Planning (rencana sebelum tool tulis
Fase 4), dan Cloud deployments 🟡 (memperkuat keputusan Fase 6 dilebur ke fase lain).

## Pertanyaan terbuka

| # | Pertanyaan | Kenapa penting |
|---|---|---|
| 1 | Knowledge base / RAG (LightRAG, SOP, runbook): dipindah, diganti skill/dokumen core, atau ditinggal? | Agent NOC berbasis LLM butuh SOP |
| 2 | ADR-015 (durable handoff) dan context engine slice C: cukup dipetakan ke sub-issue + context pack, atau butuh plugin sendiri? | Menentukan cakupan Fase 2 |
| 3 | Approve once vs always: usul ke upstream atau dibangun di plugin? | UX approval untuk tool tulis |
| 4 | ~~MCP propose → register: pakai fitur MCP core atau alur sendiri?~~ **Terjawab:** pakai MCP Tool Gateway & Apps core (sudah ✅ di upstream) | Cara menambah integrasi baru |
| 5 | Session per tab project dan agent pair: masih dibutuhkan di model issue Paperclip? | Cakupan Office Chat berikutnya |
| 6 | Windows native: tetap tidak didukung (WSL2), atau fix path Windows diusulkan ke upstream? Data dari audit: Windows native **bisa dipakai** dengan Postgres Docker, Git Bash sebagai script-shell, dan satu tambalan lokal `plugin-loader.ts`; sisa masalahnya terdaftar sebagai kandidat PR upstream (B-02, M-01, M-03, M-05) | Pengalaman developer di Windows |
| 7 | Dokumen "Starnet implementation plan" asli: masih ada salinannya? | Sumber kebenaran roadmap ini |

## Pekerjaan kecil yang terbuka

- Commit perubahan yang belum di-commit dalam satu PR: perbaikan Office Chat (OC-1), dokumen `packages/starnet-docs/`,
  `demo-seed.mjs`, dan `STARNET_PATCHES.md`. Jangan ikutkan tambalan lokal `server/src/services/plugin-loader.ts`.
- ~~Pulihkan agent NOC Engineer di Starnet Demo (di-terminate 29 Sep).~~ **Selesai 2 Okt:** seed demo membuat NOC
  baru lewat `setup` pack-isp; `setup` kini juga menautkan ulang routine "Daily PPPoE check" bila routine masih menunjuk
  agent lama (sebelumnya routine tertinggal `paused` pada agent yang di-terminate). Cek harian STAA-27 selesai oleh NOC baru.
- Template agent Starnet memakai tier dari `@starnet/pack-kit` (Fase 3.3), dan catat `check:models` di
  [06-pengembangan-lokal.md](./06-pengembangan-lokal.md).
- Perbarui bagian "Status rencana" di `.github/README.md`: plugin `starnet.memory` dan Memory UI sudah selesai.
- Commit perbaikan Windows untuk `packages/starnet-devkit/scripts/demo-seed.mjs` dan catatan kandidat PR upstream 7.
- README devkit masih menyebut default branch fork `master`; sekarang sudah `starnet/main`, jadi jadwal sync bisa
  berjalan. Perbarui kalimat itu. Secret `STARNET_SYNC_TOKEN` tetap disarankan agar PR sync memicu CI dan bisa
  menyentuh `.github/workflows/**`.
