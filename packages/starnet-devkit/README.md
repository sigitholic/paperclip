# `@starnet/devkit`

Developer tooling for the Starnet fork. It talks **REST only** to a **local** Paperclip instance and never opens a database connection.

## Safety

- Every script drops `DATABASE_URL` from its environment. On the box that variable points at another Postgres.
- Scripts refuse any `PAPERCLIP_URL` that is not loopback, unless `STARNET_DEVKIT_ALLOW_REMOTE=1` is set.
- On the box, start, stop and use the instance only through `/workspace/paperclip-start.sh`, `/workspace/paperclip-stop.sh` and `/workspace/paperclip-cli.sh`. Never run `pnpm dev` or `paperclipai` directly.
- State (ids, plus the fake-device password in live mode) lives in `.state/demo.json`, with mode 0600 and gitignored. Nothing prints secrets.

## Commands

| Command | What it does |
| --- | --- |
| `node packages/starnet-devkit/scripts/demo-seed.mjs [--live\|--mock] [--company "Starnet Demo"]` | Idempotent. Creates the company, checks that the Starnet plugins are installed and `ready` (installs from local paths if missing), runs the ISP pack `setup` (NOC Engineer + Daily PPPoE check), creates the deny-by-default tool profile "Starnet NOC (read-only)" and binds it to the NOC agent, then sets the pack config: mock, or live against the fake servers. |
| `node packages/starnet-devkit/scripts/fake-servers.mjs` | Fake RouterOS REST (`127.0.0.1:18728`, basic auth) and GenieACS NBI (`127.0.0.1:17557`) for a `--live` demo. Logs method, path and auth status only. |
| `pnpm --filter @starnet/devkit e2e` | E2E against the running instance; skipped if it is down. Seeds first. In live mode it starts the fake servers itself. Writes `.state/last-e2e.json`. |
| `pnpm --filter @starnet/devkit test` | Unit tests (fake servers, env guard) + patch-marker check. Runs in CI. |
| `node packages/starnet-devkit/scripts/patch-markers.mjs [--against upstream/master]` | `STARNET_PATCHES.md` ⇄ `// STARNET-PATCH P-n` markers, plus the list of core files changed. |

## What the E2E covers

1. **Chat flow.**
   - Office Chat `send "cek PPPoE aktif di router"` creates an issue assigned to NOC Engineer.
   - The office stream (SSE, core patch P-0) delivers `agent.run.started`, and the Virtual Office desk shows **busy** while the run is live.
   - The NOC run calls the four ISP tools through the tool gateway. In live mode, the fake servers see authenticated requests and the reply contains `FAKE-CCR2004`; in mock mode it contains `MOCK`.
   - The agent reply appears in the chat thread, the issue becomes `done`, the office stream delivers `agent.run.finished`, and the desk returns to **idle**.
2. **Routine latency (plan 0.4).** Three manual routine runs; each is timed from `run-daily-check` to `agent.run.started`. The test asserts p95 ≤ 15 s.

Example (`mock`, 27 Sep 2026): run started +108 ms, desk busy +341 ms, reply +0.9 s, desk idle +1.2 s, routine p95 91 ms.
