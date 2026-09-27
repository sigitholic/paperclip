# Starnet ISP Pack (`starnet.pack-isp`)

The first Starnet "pack", built as a plain Paperclip plugin with **zero core edits**. It includes:

- **4 read-only tools**, called by agents through the Paperclip tool gateway as `starnet.pack-isp:<name>`:
  - `mikrotik.list_pppoe_active` — RouterOS REST `GET /rest/ppp/active`, filtered to `service=pppoe`
  - `mikrotik.system_resource` — RouterOS REST `GET /rest/system/resource`
  - `genieacs.list_devices` — GenieACS NBI `GET /devices/?query=…&projection=…`
  - `genieacs.device_status` — GenieACS NBI, filtered by `_id`
- **NOC Engineer**: a plugin-managed agent. It uses the `process` adapter to run `agent/noc-check.mjs`, a deterministic script that needs no LLM. Swap in an LLM adapter later; the tools stay the same.
- **Daily PPPoE check**: a plugin-managed routine (cron `0 7 * * *`, `Asia/Jakarta`). It creates an issue for the NOC Engineer, who calls the tools, posts one summary comment and closes the issue.
- **NOC status**: a dashboard widget that reads the last snapshot from plugin state (`last-check`, company scope).

## Mock vs live

Each source (MikroTik, GenieACS) is **mock** until its host is configured:

- **Mock:** tools return fixture data (137 PPPoE sessions, CPU 23%, 36/40 CPE online). Every mock tool result starts with `[MOCK DATA — no device configured]`, and the snapshot records `mode: "mock"`. The agent comment and the widget say which sources are mock.
- **Live:** tools make real HTTP calls using `AbortSignal.timeout(timeoutMs)` (default 8 s). Error messages contain only the origin and path, never credentials.

## Config (per company)

Set the config with `POST /api/plugins/:pluginId/config` `{ companyId, configJson }` or on the plugin settings page.

| key | meaning |
| --- | --- |
| `mikrotikHost`, `mikrotikPort`, `mikrotikUseTls` (default `true`), `mikrotikUsername` | RouterOS REST endpoint (RouterOS ≥ 7.1). Use a read-only RouterOS user group. |
| `mikrotikPassword` | **secret-ref**: `{ "type": "secret_ref", "secretId": "<company secret id>" }` |
| `genieacsBaseUrl`, `genieacsUsername` | NBI URL, e.g. `http://acs:7557` |
| `genieacsPassword` | **secret-ref** (optional) |
| `onlineWindowMinutes` (15), `timeoutMs` (8000) | tuning |

How secrets are handled:

- Store passwords as Paperclip company secrets (`POST /api/companies/:id/secrets`) and put only the reference in the config.
- The host binds the secret to this plugin at that `configPath`.
- The worker resolves the secret on every call with `ctx.secrets.resolve(ref, { companyId, configPath })`. It never stores or logs the value.

TLS limitation: Node `fetch` rejects self-signed RouterOS certificates. Use a CA-signed or internal-CA certificate trusted with `NODE_EXTRA_CA_CERTS`, or plain HTTP on a management VLAN only.

## Setup (once per company)

1. Build and install the plugin:
   ```
   pnpm --filter @starnet/plugin-pack-isp build
   paperclipai plugin install ./packages/plugins/starnet-pack-isp
   ```
2. Create the NOC Engineer agent and the routine (idempotent):
   `POST /api/plugins/:pluginId/actions/setup` `{ "companyId": "…", "params": { "companyId": "…" } }`
3. **Board step: grant the tools.**
   - The gateway is deny-by-default. Neither a plugin nor `permissions.pluginTools` can grant tool access; a board user has to.
   - Create a tool profile `defaultAction: "deny"` that has four `tool_name` entries, one per `starnet.pack-isp:*` tool, and bind it to the NOC Engineer (`targetType: "agent"`).
   - API: `POST /api/companies/:id/tools/profiles`, then `…/tools/profiles/:profileId/bind`.
4. Optional manual run: `POST /api/plugins/:pluginId/actions/run-daily-check` (same body as setup).

## Least privilege

- New NOC agents are declared with `canCreateAgents: false, canCreateSkills: false` (the host otherwise lets a newly created agent hire agents, which also makes it a task assigner).
- Managed-agent reconcile does **not** update an agent that already exists. For agents created before this change, a board user runs once per agent:
  `PATCH /api/agents/:agentId/permissions` `{ "canCreateAgents": false, "canCreateSkills": false, "canAssignTasks": false }`
  (`pluginTools` is kept; the devkit `seed` script does this automatically for the demo company.)
- Known limit (Paperclip core, not changed by Starnet): every active company member can still assign tasks (`access.taskAssignSource: "simple_default"`). Turning that off needs a core change, so it is only an upstream proposal.

## Routine timing (ops note)

- The heartbeat scheduler checks routines every 30 s (`HEARTBEAT_SCHEDULER_INTERVAL_MS`, default 30000). A routine can therefore start up to ~30 s after its cron minute. This is normal.
- If the host is asleep or paused, nothing runs. With `catchUpPolicy: "skip_missed"` a missed slot fires **once** when the host wakes up; older slots are skipped. This is intended. (The 27 Sep 2026 "late run" on the dev box was the box being paused from about 03:06 to 07:51 WIB, not a scheduler bug.)
- Production must run on an always-on server.
- Measured on the dev box (devkit E2E): manual run → run started p95 ≈ 0.1 s.

## Risk classification and future write tools

The gateway infers risk **from the tool name only** (`inferToolRisk` in `server/src/services/tool-gateway.ts`). Plugins have no explicit `risk` field yet.

- destructive: `delete|destroy|remove|drop|truncate|wipe|purge`
- write: `create|update|write|edit|patch|post|send|publish|merge|commit|apply`
- anything else → **read**

Watch out: `reboot`, `disable`, `kick` or `reset` alone would be classified as **read**.

Until upstream adds a `risk` field:

1. **Naming rule.** Every mutating tool must contain a write or destructive verb:
   - `mikrotik.apply_reboot`
   - `mikrotik.update_pppoe_secret`
   - `mikrotik.remove_active_session` (kick a user)
   - `olt.update_port_state`
   - `genieacs.apply_reboot`
   - `genieacs.delete_device`
2. **Fail fast.** At startup, `@starnet/pack-kit` `assertGatewayRisk(name, expected)` checks each tool with a copy of the gateway regex. A rename that would downgrade a write tool to `read` crashes the worker instead of shipping.
3. **Policy.** Bind write tools only through a separate tool profile, and add a `require_approval` tool policy (board) for `risk_level: write/destructive`. The gateway then parks the call as an action request until a human approves it.
4. **Defence in depth (planned).** Write handlers will also refuse to run unless the plugin config has an explicit `allowWrites: true` for that company.
5. **Upstream PR wanted.** An optional `risk: "read" | "write" | "destructive"` field on `PluginToolDeclaration`, preferred over the name heuristic (see `STARNET_PATCHES.md`).

## Demo knob

If the `starnet.memory` plugin is installed, `agent/noc-check.mjs` pulls its curated context pack once per run (`GET /api/plugins/starnet.memory/api/context/:issueId?tools=…`, run token). It logs sizes only, lists the board pins it used in its comment, and continues without memory if the plugin is missing. Its comment starts with a `Hasil:` line, which the memory plugin uses as the L1 headline.

`agent/noc-check.mjs` honours `NOC_DEMO_DELAY_MS` (off by default, capped at 60 s). It keeps the run open after the tool calls, so live UIs such as Virtual Office can be observed. Set it in the agent's `adapterConfig.env`.

## Develop

```
pnpm --filter @starnet/plugin-pack-isp typecheck
pnpm --filter @starnet/plugin-pack-isp test   # mock + live (fake HTTP server) + timeout tests
pnpm --filter @starnet/plugin-pack-isp build
```
