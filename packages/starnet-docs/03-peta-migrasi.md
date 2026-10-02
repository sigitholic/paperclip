# 3. Peta migrasi: Starnet Office → Starnet Paperclip

Tabel ini adalah daftar kerja migrasi. Setiap baris menjawab: kemampuan apa di Starnet Office, apa padanannya di
Paperclip, dan statusnya sekarang.

Arti status:

| Status | Arti |
|---|---|
| ✅ **Selesai** | Sudah dibangun sebagai plugin/paket Starnet dan lolos E2E |
| 🟦 **Core** | Sudah disediakan core Paperclip; tidak perlu dibangun ulang, cukup dipakai atau dikonfigurasi |
| 🟨 **Sebagian** | Ada padanan, tapi belum setara dengan desain Starnet Office |
| ⬜ **Rencana** | Masuk roadmap fork, belum dikerjakan |
| ❓ **Belum diputuskan** | Belum ada di roadmap; perlu keputusan dipindah, diganti fitur core, atau ditinggal |

Status "Core" berarti tabel dan fiturnya ada di core. Kecocokan perilakunya dengan desain Starnet Office belum diuji
satu per satu, jadi tiap baris "Core" perlu dicoba sebelum dianggap final.

## 3.1 Fondasi platform

| Starnet Office | Referensi | Padanan Paperclip | Status |
|---|---|---|---|
| Organization, multi-tenant, RLS | Langkah 15, 19 | Company; batas company di route/service | 🟦 Core |
| User, undangan, RBAC | Langkah 15–17 | Board user, membership company, undangan | 🟦 Core |
| Project | Langkah 14 | Project | 🟦 Core |
| Task, subtask, dependency, assignment | Langkah 24 | Issue, sub-issue, blocker, single assignee, checkout atomik | 🟦 Core |
| Discussion per task | Langkah 25 | Komentar issue, dokumen issue | 🟦 Core |
| AgentRun, agent_logs | Langkah 26–27a | Heartbeat run + run log (`heartbeat_run_events`) | 🟦 Core |
| Artifact | Langkah 27e | Work product dan dokumen issue | 🟦 Core |
| Audit log | Langkah 29 | Activity log | 🟦 Core |
| Budget AI per organisasi | Langkah 19, 26 | Budget policy dengan hard-stop/auto-pause | 🟦 Core |
| Notifikasi, Inbox | Langkah 12, ADR-011 fase C | Inbox Paperclip | 🟦 Core (event `human_needed` belum dipetakan) |
| Realtime SSE / presence | Langkah 6, 16–17 | Event domain + stream bridge plugin | ✅ Selesai lewat patch P-0 |
| Scheduler | — | Routine (cron, zona waktu, catch-up) | 🟦 Core |

## 3.2 Tool, keamanan, approval

| Starnet Office | Referensi | Padanan Paperclip | Status |
|---|---|---|---|
| Tool pipeline: permission → risk → approval → executor | ADR-001 | Tool gateway deny-by-default + tool profile + tool policy | 🟦 Core |
| Approval hanya untuk HIGH/CRITICAL | ADR-002 | Tool policy `require_approval` per `risk_level` | 🟦 Core (risiko ditebak dari nama tool) |
| Connector MikroTik (read) | ADR-003 | `starnet.pack-isp`: `mikrotik.list_pppoe_active`, `mikrotik.system_resource` | ✅ Selesai |
| Connector GenieACS (read) | ADR-003 | `starnet.pack-isp`: `genieacs.list_devices`, `genieacs.device_status` | ✅ Selesai |
| Monitoring NMS (Zabbix, LibreNMS) | — | `starnet.pack-nms`: `nms.list_problems`, `nms.host_status`, webhook alert → issue NOC | ✅ Selesai (uji live NMS menunggu URL/token) |
| Connector OLT (ZTE) | ADR-003 | Pack OLT | ⬜ Rencana (Fase 4) |
| Tool tulis ke perangkat (di balik approval) | ADR-002, ADR-011 | Tool dengan kata kerja tulis + profile terpisah + `require_approval` + `allowWrites` | ⬜ Rencana (Fase 4) |
| Kredensial terenkripsi, `secretRef` | Langkah 21 | Company secret + secret-ref | ✅ Selesai (dipakai pack-isp) |
| MCP client (tool tipe `mcp`) | ADR-003 | Koneksi MCP / tool access core (`tool_access_mcp_connections`, MCP gateway) | 🟦 Core (belum dicoba untuk Starnet) |
| MCP propose → approve → register | ADR-003 | — | ❓ Belum diputuskan |
| Custom tool per org (HTTP/MCP) + grant | ADR-015 T3 | Plugin tool + tool profile; koneksi MCP core | 🟨 Sebagian |
| Pack contract (tool wajib vs opsional) | ADR-015 T | Manifest plugin (deklarasi tool + capability) | 🟨 Sebagian |
| Approve once vs always | ADR-011 fase G | Tidak ditemukan di core | ❓ Belum diputuskan (kandidat PR upstream) |
| Least privilege agent | — | Permission agent (`canCreateAgents`, `canCreateSkills`, `canAssignTasks`) | ✅ Selesai (seed + deklarasi NOC) |

## 3.3 Agent plane

| Starnet Office | Referensi | Padanan Paperclip | Status |
|---|---|---|---|
| Agent + 9 `roleKey` terkunci | Vision §2 | Agent dengan title, reporting line, capabilities; tidak ada `roleKey` terkunci | 🟦 Core (model berbeda) |
| Agent NOC | Vision §2 | NOC Engineer, adapter `process`, skrip deterministik tanpa LLM | ✅ Selesai (versi deterministik) |
| Agent NOC berbasis LLM | — | Adapter LLM (Claude, Codex, dan lain-lain) dengan tool yang sama | ⬜ Rencana (Fase 2) |
| Execution loop observe → plan → act → evaluate | Vision §3.2, LC-1 | Adapter + heartbeat; loop milik runtime agent | ⬜ Rencana (runtime adapter Starnet, Fase 2) |
| Context engine (curated run context) | ADR-012 slice C | `@starnet/memory-core` `buildBundle` + context pack | 🟨 Sebagian (agent harus menarik sendiri) |
| Sandbox per run (host allowlist, Docker opsional) | ADR-006 | Environments + plugin sandbox provider (Daytona, E2B, Modal, Kubernetes, dan lain-lain) | 🟦 Core (belum dipakai Starnet; Fase 2) |
| Model router fast/standard/reasoning | ADR-005 | Konfigurasi model per agent di adapter; `ai_provider_defaults` | 🟨 Sebagian (tier otomatis belum ada; Fase 3) |
| Session lane per session (serialisasi run) | ADR-013 | Checkout atomik issue + single assignee | 🟦 Core (serialisasi per issue, bukan per session) |
| Durable handoff board (claim, heartbeat, ringkasan) | ADR-015 B | Sub-issue + checkout + komentar ringkasan; slot Handoff di context pack | 🟨 Sebagian |
| Quality gate QA + security + evidence | ADR-012, LC-4 | Review/approval handoff issue; `issue_execution_decisions` | 🟨 Sebagian (QA gate Starnet di Fase 2) |
| Workspace IDE | WS-2, WS-3 | Project/execution workspace + runtime service | 🟦 Core |

## 3.4 Memory dan knowledge

| Starnet Office | Referensi | Padanan Paperclip | Status |
|---|---|---|---|
| Memory admission, anti-poisoning, quarantine | ADR-004 | `@starnet/memory-core` `admit()` | ✅ Selesai |
| Memory L1 session (ringkasan deterministik, pin) | ADR-014 | `starnet.memory`: L1 per agent+issue dan per agent, pin via komentar/UI | ✅ Selesai |
| Memory L2/L3 (agent/proyek) | ADR-014 | Item memori agent/project/company di plugin | 🟨 Sebagian |
| Panel Memory di UI | ADR-014 | Halaman Memori, "Memori per agen", widget | ✅ Selesai |
| Pengukuran hemat token | — | `bundle_log` + `compareToNaive` | ✅ Selesai |
| Knowledge base + embeddings/pgvector | Langkah 12–14, 23 | — | ❓ Belum diputuskan |
| Office RAG (LightRAG), seed SOP/runbook | README Starnet-ofice | Skill company / dokumen issue sebagai pengganti sederhana | ❓ Belum diputuskan |

## 3.5 Office dan chat

| Starnet Office | Referensi | Padanan Paperclip | Status |
|---|---|---|---|
| Office channel (chat kantor) | ADR-010 | `starnet.office-chat` | ✅ Selesai |
| Promote chat → task | ADR-011 fase B | Setiap permintaan kerja langsung jadi issue (`ctx.issues.create`) | ✅ Selesai (otomatis, tanpa kartu proposal) |
| Routing ke agent yang tepat | ADR-011 | Router: `@mention` → kata kunci domain → capabilities; hook LLM tersedia | ✅ Selesai (versi aturan) |
| Kartu proposal sebelum promote | ADR-011 fase D | — | ⬜ Belum dijadwalkan |
| Human DM per agent | ADR-009 | Agent chat core | 🟦 Core |
| Agent pair / dialog otomatis | ADR-009/010, fase E2 | — | ❓ Belum diputuskan |
| `human_needed` → Inbox + deep link | ADR-011 fase C | Inbox core; pemetaan event belum ada | ⬜ Belum dijadwalkan |
| Artifact handoff antar-agent | ADR-011 fase F | Work product + sub-issue | 🟨 Sebagian |
| Rate limit / budget per giliran office | ADR-011 fase H | Budget core (per company/agent) | 🟨 Sebagian |
| Session = tab project | ADR-013, D1 | — | ❓ Belum diputuskan |
| Virtual Office (visualisasi saja) | Vision §4 | `starnet.virtual-office`, status dari core + event | ✅ Selesai |

## 3.6 Factory, template, platform

| Starnet Office | Referensi | Padanan Paperclip | Status |
|---|---|---|---|
| Roster draft/apply dari prompt (Agent Factory) | ADR-003, `agent-generator.md` | Hire agent core + skill `company-creator` (paket company `agentcompanies/v1`) | 🟨 Sebagian (Fase 5) |
| Template office (Software/ISP/Marketing/Finance) | ADR-007 | Teams catalog core (`@paperclipai/teams-catalog`) | 🟦 Core (template Starnet belum dibuat; Fase 5) |
| Setup pack sekali klik (agent + routine + profile) | — | Action `setup` pack-isp + seed devkit | ✅ Selesai (khusus ISP) |
| Control plane inspect/pause/resume/retry | ADR-008 | Detail run, pause agent, cancel run, activity | 🟦 Core |
| Marketplace / billing | Vision §5 | — | ⬜ Paling akhir |
| Multi-tenant | Vision §5 | Company | 🟦 Core |

## 3.7 Ringkasan

- **Selesai di fork:** pack ISP read-only, NOC Engineer deterministik, routine harian, Office Chat, Virtual Office live,
  Starnet Memory lengkap (L1, pin, filter, context pack, UI), devkit dan E2E, CI, dan sync upstream.
- **Tidak perlu dibangun ulang (core):** tenant, user, issue, run, approval, budget, audit, secret, routine, inbox,
  workspace, sandbox provider, agent chat, teams catalog.
- **Pekerjaan inti berikutnya:** runtime adapter Starnet (loop, context yang disuntik, sandbox, QA gate), agent NOC
  berbasis LLM, model router, pack OLT dan tool tulis ber-approval, template office.
- **Perlu keputusan:** knowledge base/RAG, MCP propose-register, approve once, agent pair, session per tab project.
