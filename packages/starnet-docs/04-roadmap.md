# 4. Roadmap

Urutan fase mengikuti README fork (`.github/README.md`). Fase yang sudah selesai dicatat dengan PR-nya. Untuk fase yang
belum dimulai, cakupan dan kriteria selesai di bawah adalah **usulan** yang disusun dari ADR Starnet Office dan batas
Paperclip yang sudah ditemui; perlu disetujui sebelum dikerjakan.

## Status per 27 Sep 2026

| Fase | Fokus | Status |
|---|---|---|
| 0 | Fondasi: pack ISP, Office Chat, Virtual Office, P-0, CI, devkit, sync | ✅ Selesai |
| 1 | Starnet Memory | ✅ Selesai (1.1–1.4) |
| 2 | Runtime adapter Starnet (loop, konteks, sandbox, policy, QA gate) | ⬜ Berikutnya |
| 3 | Router LLM | ⬜ Rencana |
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
5. **QA gate:** issue induk tidak `done` tanpa bukti (QA + security + evidence, LC-4).
6. Agent NOC versi LLM memakai tool yang sama dengan versi deterministik.

Kriteria selesai usulan:

- E2E: pertanyaan NOC dijawab agent LLM lewat tool gateway, dengan context pack terbukti ada di prompt run.
- Tidak ada tool call di luar gateway; tool yang tidak di-grant ditolak.
- Penghematan token terukur di prompt sungguhan, bukan hanya di pack.
- `core-diff-check` tetap hijau.

Keputusan yang dibutuhkan sebelum mulai: model/provider default untuk dev, apakah loop memakai adapter LLM yang ada
(Claude/Codex) atau adapter HTTP sendiri, dan sandbox provider mana untuk dev lokal.

## Fase 3 — Router LLM (usulan)

**Tujuan:** tier `fast | standard | reasoning` per agent dan per tujuan (ADR-005), di atas konfigurasi model per agent
yang sudah ada di core.

Catatan: kaji dulu sejauh mana konfigurasi adapter dan `ai_provider_defaults` core sudah mencukupi, supaya tidak
membangun ulang. Kemungkinan besar cukup menjadi bagian dari runtime adapter Starnet (Fase 2).

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

## Pertanyaan terbuka

| # | Pertanyaan | Kenapa penting |
|---|---|---|
| 1 | Knowledge base / RAG (LightRAG, SOP, runbook): dipindah, diganti skill/dokumen core, atau ditinggal? | Agent NOC berbasis LLM butuh SOP |
| 2 | ADR-015 (durable handoff) dan context engine slice C: cukup dipetakan ke sub-issue + context pack, atau butuh plugin sendiri? | Menentukan cakupan Fase 2 |
| 3 | Approve once vs always: usul ke upstream atau dibangun di plugin? | UX approval untuk tool tulis |
| 4 | MCP propose → register: pakai fitur MCP core atau alur sendiri? | Cara menambah integrasi baru |
| 5 | Session per tab project dan agent pair: masih dibutuhkan di model issue Paperclip? | Cakupan Office Chat berikutnya |
| 6 | Windows native: tetap tidak didukung (WSL2), atau fix path Windows diusulkan ke upstream? | Pengalaman developer di Windows |
| 7 | Dokumen "Starnet implementation plan" asli: masih ada salinannya? | Sumber kebenaran roadmap ini |

## Pekerjaan kecil yang terbuka

- Perbarui bagian "Status rencana" di `.github/README.md`: plugin `starnet.memory` dan Memory UI sudah selesai.
- Commit perbaikan Windows untuk `packages/starnet-devkit/scripts/demo-seed.mjs` dan catatan kandidat PR upstream 7.
- README devkit masih menyebut default branch fork `master`; sekarang sudah `starnet/main`, jadi jadwal sync bisa
  berjalan. Perbarui kalimat itu. Secret `STARNET_SYNC_TOKEN` tetap disarankan agar PR sync memicu CI dan bisa
  menyentuh `.github/workflows/**`.
