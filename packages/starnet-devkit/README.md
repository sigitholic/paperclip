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
| `node packages/starnet-devkit/scripts/demo-seed.mjs [--live\|--mock] [--company "Starnet Demo"]` | Idempotent. Creates the company, checks that the Starnet plugins are installed and `ready` (installs from local paths if missing), runs the ISP pack `setup` (NOC Engineer, NOC Engineer (LLM), Daily PPPoE check), creates the deny-by-default tool profile "Starnet NOC (read-only)" and binds it to both NOC agents, then sets the pack config: mock, or live against the fake servers. |
| `node packages/starnet-devkit/scripts/model-tiers-check.mjs --company "Starnet Demo" [--yes] [--models a,b]` | Proves which Codex models the signed-in account can run. Without `--yes` it only lists candidates (the tier-map models in `@starnet/pack-kit` plus the models Codex advertises). With `--yes` it does one tiny real run per model through a reusable, paused-after-use "Starnet Model Probe" agent, explains failures from Codex's own log (for example `404 model does not exist`), and exits 1 when a tier-map model is unavailable. Spends a little plan quota. |
| `NINEROUTER_API_KEY=... node packages/starnet-devkit/scripts/model-tiers-check.mjs --provider 9router --base-url <url> [--tiers fast=a,standard=b,reasoning=c] [--models a,b] [--yes]` | Same check through a [9router](https://github.com/decolua/9router) gateway. The dry run lists the gateway's models (`GET /v1/models`, no quota). With `--yes` the key is stored as company secret `starnet-9router-api-key` (created or rotated) and each model is probed by a "Starnet Model Probe (9router)" agent whose `adapterConfig.env` sets `MODEL_PROVIDER`, `CODEX_CONFIG` and the key as a `secret_ref`; the bundled codex-acp reads those, so no core change and no edit to `~/.codex`. The key never appears in arguments or logs. |
| `node packages/starnet-devkit/scripts/apply-tier.mjs --base-url <url> --tiers fast=a,standard=b,reasoning=c [--secret <name>] [--agent <name> --tier <tier>] [--resume] [--yes]` | Resolves the tier that Starnet agent templates declare (`adapterConfig.starnetTier`, set by `tierTemplate()` in `@starnet/pack-kit`) against one company's tier map and writes model, 9router URL and the key `secret_ref` into each agent (`starnet_9router` adapter). Plugins cannot edit an agent's config after creating it, so tiered templates start paused; `--resume` resumes them. `--agent` targets one agent, `--provider chatgpt` uses `DEFAULT_CODEX_TIERS` on `codex_local`. The key secret must exist (`--secret`, default `starnet-9router-api-key`) or `NINEROUTER_API_KEY` is set once to create it. Dry run without `--yes`. |
| `node packages/starnet-devkit/scripts/fake-servers.mjs` | Fake RouterOS REST (`127.0.0.1:18728`, basic auth) and GenieACS NBI (`127.0.0.1:17557`) for a `--live` demo. Logs method, path and auth status only. |
| `pnpm --filter @starnet/devkit e2e` | E2E against the running instance; skipped if it is down. Seeds first. In live mode it starts the fake servers itself. Writes `.state/last-e2e.json` and `.state/last-e2e-memory.json`. If your shell exports another `PAPERCLIP_URL`, pass `PAPERCLIP_URL=http://127.0.0.1:3100`. |
| `pnpm --filter @starnet/devkit test` | Unit tests (fake servers, env guard) + patch-marker check. Runs in CI. |
| `node packages/starnet-devkit/scripts/core-diff-check.mjs [--against upstream/master]` | Fails if any Paperclip core file differs from upstream except the four files of the approved streaming patch P-0 (the no-core-edits rule). Runs in CI and in the sync. |

## What the E2E covers

1. **Chat flow.**
   - Office Chat `send "cek PPPoE aktif di router"` creates an issue assigned to NOC Engineer.
   - The office stream (SSE, core patch P-0) delivers `agent.run.started`, and the Virtual Office desk shows **busy** while the run is live.
   - The NOC run calls the four ISP tools through the tool gateway. In live mode, the fake servers see authenticated requests and the reply contains `FAKE-CCR2004`; in mock mode it contains `MOCK`.
   - The agent reply appears in the chat thread, the issue becomes `done`, the office stream delivers `agent.run.finished`, and the desk returns to **idle**.
2. **Routine latency (plan 0.4).** Three manual routine runs; each is timed from `run-daily-check` to `agent.run.started`. The test asserts p95 ≤ 15 s.
3. **Starnet Memory (`e2e/memory-flow.e2e.test.mjs`).**
   - Run 1 (NOC) → the memory plugin writes L1 for the issue and for the agent from run events; the `memory` stream delivers `l1.updated`.
   - Board writes: a `catat:` comment on an unassigned issue (company-scope pin), a pin from the Memory UI action (agent scope), a poisoning attempt (quarantined), a secret (rejected, not stored) and a raw transcript (rejected). The test checks the secret never appears in memory.
   - Run 2 on a new issue → the NOC script pulls its context pack from `GET /api/plugins/starnet.memory/api/context/:issueId` with its run token. The pack contains the agent L1 from run 1 and both pins, and no quarantined text; the NOC comment lists the pins and the savings.
   - Size vs a naive history dump (this issue's thread + the last 24 comments on the agent's other issues) is reported; the UI slots (page, sidebar, 2 detail tabs, widget) and the UI data are checked.
   - Pins created by the test are forgotten afterwards unless `STARNET_E2E_KEEP_MEMORY=1`.

Example (`mock`, 27 Sep 2026): run started +108 ms, desk busy +341 ms, reply +0.9 s, desk idle +1.2 s, routine p95 91 ms. Memory: context pack 665 chars (~167 tokens) vs naive history 11 906 chars (~2 977 tokens), 94.4% smaller.

## Upstream sync (weekly)

`packages/starnet-devkit/scripts/upstream-sync.sh [--push] [--pr] [--no-checks] [--server-tests]`

1. `git fetch upstream master`. If `starnet/main` already contains upstream, the script stops with "up to date".
2. Branch `starnet/sync-YYYYMMDD` from `origin/starnet/main`, then `git merge --no-ff upstream/master` (a merge, not a rebase, so fork history stays intact).
3. On conflicts, `pnpm-lock.yaml` is taken from upstream and regenerated. Any other conflict stops the script: it lists the files and exits with code 2. Conflicts are never resolved by editing core beyond keeping P-0 intact; stop and report instead. With `--pr`, it commits the markers and opens a **draft** fork PR listing the conflicting files.
4. `pnpm install --no-frozen-lockfile`; the regenerated lockfile is committed.
5. Checks run: no core file differs from upstream except the P-0 streaming patch (`core-diff-check.mjs`). Then the Starnet typecheck, test and build, the repo boundary checks, and (with `--server-tests`) the P-0 server tests. A failed check exits with code 3; with `--pr` the PR is opened as a draft.
6. A report goes to `.state/sync-report.md`: upstream commits, conflicts, checks, core files, **new upstream workflows to disable**, and new DB migrations. With `--pr` the report becomes the PR body. The PR always targets `sigitholic/paperclip:starnet/main`; nothing is opened upstream.

After merging a sync PR:

1. Restart the local instance with `/workspace/paperclip-stop.sh` and then `/workspace/paperclip-start.sh`, so that migrations run.
2. Wait for `/api/health`.
3. Run `pnpm --filter @starnet/devkit e2e`.

The workflow `.github/workflows/starnet-upstream-sync.yml` runs the same script: weekly on Mondays at 02:00 WIB, or on demand with "Run workflow". Two GitHub limitations apply:

- **Schedule needs the default branch.** A `schedule` only fires from the repository's **default branch**. The fork's default branch is now `starnet/main`. If it is still set to `master`, switch it in the repository settings or trigger the workflow manually.
- **GITHUB_TOKEN is too weak.** It cannot push merges that touch `.github/workflows/**`, and PRs it opens don't trigger `pull_request` CI (the script dispatches `starnet-ci` itself to compensate). Opening the PR also needs "Allow GitHub Actions to create and approve pull requests" to be on. Adding a fine-grained PAT as the repo secret `STARNET_SYNC_TOKEN` (fork only; contents, pull requests and workflows read/write) avoids all of this.
