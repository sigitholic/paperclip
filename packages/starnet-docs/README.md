# Dokumentasi Proyek Starnet

Dokumentasi lengkap proyek **Starnet**: platform "kantor AI" untuk ISP/NOC dan domain lain, yang sekarang dibangun
di atas fork [Paperclip](https://github.com/paperclipai/paperclip) (`sigitholic/paperclip`, branch `starnet/main`).

Proyek ini adalah generasi kedua. Generasi pertama, **Starnet Office / StarClaw** (repo privat
`sigitholic/Starnet-ofice`), dibangun dari nol dan belum sempurna. Kami memutuskan memindahkan semua kemampuannya ke
fork Paperclip ini, sebagai plugin dan paket baru, tanpa mengubah kode inti Paperclip.

> Folder ini hanya berisi dokumentasi (tidak ada `package.json`), jadi tidak ikut di-build atau di-test oleh CI.
> Letaknya di `packages/starnet-*` supaya lolos aturan "no core edits" (`core-diff-check.mjs`).

## Daftar isi

| # | Dokumen | Isi |
|---|---|---|
| 1 | [Latar belakang dan keputusan](./01-latar-belakang-dan-keputusan.md) | Dari Starnet Office ke Paperclip: masalahnya apa, kenapa pindah, aturan yang kami pegang |
| 2 | [Arsitektur](./02-arsitektur.md) | Bagaimana Starnet menempel di Paperclip: konsep inti, paket, alur data, keamanan |
| 3 | [Peta migrasi](./03-peta-migrasi.md) | Setiap fitur dan ADR Starnet Office, padanannya di Paperclip, dan statusnya |
| 4 | [Roadmap](./04-roadmap.md) | Fase 0–6: yang sudah selesai (dengan PR), kemajuan terbaru, keselarasan dengan `ROADMAP.md` upstream, dan pertanyaan terbuka |
| 5 | [Aturan kerja dan kontribusi](./05-aturan-kerja.md) | Aturan no-core-edits, patch P-0, alur PR, sync upstream, CI |
| 6 | [Pengembangan lokal](./06-pengembangan-lokal.md) | Menjalankan di Linux/macOS/WSL2 dan di Windows native (dengan catatan khusus) |
| 7 | [Audit bug 2026-09-27](./07-audit-bug-2026-09-27.md) | Temuan bug dari instance lokal Windows: pembuatan agent, run agent, plugin, UI; prioritas dan rencana perbaikan |

## Ringkasan satu paragraf

Starnet memakai Paperclip sebagai **control plane**: company, agent, issue, routine, approval, budget, secret, audit,
dan tool gateway yang deny-by-default semuanya sudah disediakan core. Starnet menambahkan **nilai domain** di atasnya
lewat plugin: pack ISP (MikroTik, GenieACS) dengan agent NOC Engineer, Office Chat (chat yang mengubah permintaan jadi
issue untuk agent yang tepat), Virtual Office (meja agent dengan status live), dan Starnet Memory (context pack yang
hemat token). Semuanya berjalan dalam mode mock sampai perangkat asli dikonfigurasi. Fase 0 dan 1 sudah selesai; fase
berikutnya adalah runtime adapter Starnet (Fase 2).

## Dokumen terkait di repo

- [`.github/README.md`](../../.github/README.md): README Starnet di halaman depan GitHub (quickstart, cara pakai).
- [`STARNET_PATCHES.md`](../../STARNET_PATCHES.md): daftar patch core (hanya P-0) dan kandidat PR upstream.
- README tiap paket: [pack-isp](../plugins/starnet-pack-isp/README.md), [pack-nms](../plugins/starnet-pack-nms/README.md), [office-chat](../plugins/starnet-office-chat/README.md),
  [virtual-office](../plugins/starnet-virtual-office/README.md), [memory](../plugins/starnet-memory/README.md),
  [memory-core](../starnet-memory-core/README.md), [devkit](../starnet-devkit/README.md).
- Dokumentasi Paperclip upstream: [`doc/PRODUCT.md`](../../doc/PRODUCT.md), [`doc/SPEC-implementation.md`](../../doc/SPEC-implementation.md),
  [`doc/DEVELOPING.md`](../../doc/DEVELOPING.md).

## Catatan sumber

Dokumen ini disusun ulang pada 27 Sep 2026 dari: dokumen dan 15 ADR di repo Starnet-ofice, body PR #1–#15 di fork,
README paket Starnet, dan `STARNET_PATCHES.md`.

Dokumen "Starnet implementation plan" (yang dirujuk PR sebagai "Phase 0.2", "plan 0.4", "§4") dan brief
`starnet-memory-v1` **tidak pernah di-commit** ke repo mana pun. Isinya direkonstruksi dari PR dan README. Kalau
salinan aslinya masih ada, sebaiknya ditambahkan ke folder ini sebagai sumber kebenaran.
