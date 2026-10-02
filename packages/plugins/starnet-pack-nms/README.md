# Starnet NMS Pack (`starnet.pack-nms`)

Plugin Paperclip untuk monitoring jaringan dari **Zabbix** dan **LibreNMS**:

1. **Tool read-only** untuk agent NOC (lewat tool gateway, butuh grant di tool profile).
2. **Webhook alert**: NMS mengirim alert, plugin membuat issue NOC dan menutupnya otomatis saat pulih.

Tanpa edit core Paperclip. Tanpa source NMS, tool memakai data MOCK yang selalu berlabel `[MOCK DATA …]`.

## Tool

| Tool | Isi | Parameter |
|---|---|---|
| `nms.list_sources` | Nama, jenis, URL source (tanpa kredensial) | — |
| `nms.list_problems` | Problem aktif semua source, severity tertinggi dulu | `source?`, `minSeverity?` (`info`/`warning`/`average`/`high`/`disaster`), `limit` (default 50) |
| `nms.host_status` | Status host up/down/unknown/disabled + alamat | `source?`, `query?`, `onlyDown?`, `limit` (default 50) |

Nama tool tidak memakai kata kerja tulis, jadi gateway mengklasifikasikannya `read` (`assertGatewayRisk` saat
registrasi). Source yang gagal dilaporkan `UNREACHABLE` tanpa menggagalkan source lain; tool hanya gagal bila semua source
gagal. Pesan error tidak pernah memuat token.

| NMS | API | Autentikasi | Versi |
|---|---|---|---|
| Zabbix | JSON-RPC `POST {url}/api_jsonrpc.php`: `trigger.get` (problem aktif), `host.get` (ketersediaan interface) | API token sebagai `Authorization: Bearer` | 5.4+ (API token) |
| LibreNMS | REST `/api/v0`: `/alerts?state=1`, `/rules`, `/devices?type=all` | Header `X-Auth-Token` | API v0 |

Pakai user NMS dengan hak **read-only**.

## Konfigurasi

Buka **Settings → Plugins → Starnet NMS Pack** (halaman pengaturan milik plugin):

- **Sumber NMS**: tabel source (nama unik, jenis, URL, token). Token dipilih dari company secret atau dibuat inline;
  nilainya langsung masuk secret store host dan tidak pernah tampil lagi.
- **Alert → Issue NOC**: secret webhook (kosong = webhook nonaktif), agent penerima issue, severity minimum
  (default `warning`), batas issue baru per jam (default 30, pelindung badai alert).
- **Tes koneksi**: memanggil `host.get` / `/devices` per source dari config yang tersimpan.

Bentuk config (disimpan per company):

```json
{
  "nmsSources": [
    { "name": "zabbix-pusat", "kind": "zabbix", "baseUrl": "https://nms.example/zabbix", "token": { "type": "secret_ref", "secretId": "…" } },
    { "name": "librenms", "kind": "librenms", "baseUrl": "https://librenms.example", "token": { "type": "secret_ref", "secretId": "…" } }
  ],
  "webhookToken": { "type": "secret_ref", "secretId": "…" },
  "alertAssigneeAgentId": "…",
  "alertMinSeverity": "warning",
  "maxNewIssuesPerHour": 30,
  "timeoutMs": 8000
}
```

## Webhook alert

`POST /api/plugins/starnet.pack-nms/webhooks/alerts` (route host tanpa login; plugin yang memverifikasi).

Header:

- `x-starnet-company: <companyId>`
- salah satu dari:
  - `x-starnet-signature: sha256=<hex HMAC-SHA256(raw body, secret webhook)>`. Dipakai template Zabbix.
  - `x-starnet-token: <secret webhook>`. Dipakai LibreNMS, karena LibreNMS tidak bisa menandatangani payload.

Body: satu objek atau array (maksimal 50 per kiriman):

```json
{ "source": "zabbix", "eventId": "123", "status": "problem", "severity": "high", "host": "OLT-1", "name": "PON down", "since": "…", "url": "https://…" }
```

`status` menerima `problem`/`resolved` serta ejaan Zabbix/LibreNMS (`1`/`0`, state LibreNMS 0–4). `severity` menerima
nama, angka Zabbix 0–5, atau `ok`/`warning`/`critical` LibreNMS.

Perilaku:

| Kejadian | Hasil |
|---|---|
| Problem baru, severity ≥ minimum | Issue `[SEV] host: masalah`, prioritas disaster→critical, high→high, average→medium, lainnya→low, di-assign ke agent pilihan |
| Problem yang sama dikirim ulang (issue masih terbuka) | Diabaikan (dedupe lewat `originKind` `plugin:starnet.pack-nms:alert` + `originId` `source:eventId`) |
| Status pulih | Komentar "Pulih", issue jadi `done` |
| Problem muncul lagi setelah issue ditutup | Issue baru (LibreNMS memakai ulang id per device+rule) |
| Di atas batas per jam | Tidak membuat issue; jumlahnya tampil di widget |

Template Zabbix (media type Webhook) dan LibreNMS (transport API) bisa disalin dari halaman pengaturan setelah secret
webhook dipilih. Untuk Zabbix, simpan secret di global macro `{$STARNET_WEBHOOK_SECRET}` bertipe *Secret text*.

**Batasan host:**

- Host mencatat header dan body setiap kiriman di `plugin_webhook_deliveries`. Karena itu Zabbix memakai HMAC
  (secret tidak ikut terkirim). Token LibreNMS ikut tercatat di DB instance, jadi pakai secret khusus untuk webhook
  ini dan rotasi bila perlu.
- Di luar invocation, host hanya mengizinkan company yang sudah menyimpan config plugin ini. Company lain ditolak.
- URL webhook harus bisa dijangkau server NMS (instance lokal `localhost:3100` tidak bisa dari luar).

## Integrasi NOC

- Seed devkit memasang plugin dan memberi grant ketiga tool ke profile "Starnet NOC (read-only)".
- NOC deterministik (`starnet-pack-isp/agent/noc-check.mjs`) menambahkan bagian "NMS problems" ke laporan harian bila
  tool NMS terlihat. Problem `high`/`disaster` dari data live masuk daftar alert; data MOCK hanya diberi label.
- NOC LLM bisa memanggil `node pack-tool.mjs starnet.pack-nms:nms.list_problems minSeverity=high`.

## Pengembangan

```sh
pnpm --filter @starnet/plugin-pack-nms build
pnpm --filter @starnet/plugin-pack-nms test       # server Zabbix/LibreNMS palsu + webhook
pnpm --filter @starnet/plugin-pack-nms typecheck
```
