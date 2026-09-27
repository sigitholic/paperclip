# Starnet patches to Paperclip core

This fork (`sigitholic/paperclip`, branch `starnet/main`) aims to keep **zero** edits to Paperclip core. Starnet features ship as plugins under `packages/plugins/starnet-*`.

## Core patches

| # | File(s) | Why | Upstream status |
| --- | --- | --- | --- |
| — | none | — | — |

**The `starnet/pack-isp` spike needed no core patch.** The only file outside `packages/plugins/starnet-*` that changed is `pnpm-lock.yaml`, which pnpm regenerated to add the two workspace packages.

## Upstream PR candidates (nice-to-have, not blocking)

1. **Explicit tool risk.** Add an optional `risk: "read" | "write" | "destructive"` to plugin tool declarations and use it before the name heuristic (`inferToolRisk`, `server/src/services/tool-gateway.ts`). Today a tool like `mikrotik.reboot` is classified as `read`.
2. **Routine `issueTemplate.originId`.** The SDK allows it, but setting it breaks routine runs: later queries treat `issues.originId` as the routine UUID and fail (`routine_runs.routine_id = 'routine:…'`). Either drop the field from `PluginManagedRoutineDeclaration.issueTemplate` or stop using it as a routine id.
3. **Pack-provisioned tool grants.** Let a plugin *propose* a tool profile for its managed agent, for a board to approve. Right now a board user has to create and bind the profile by hand; `permissions.pluginTools` alone does not grant access.
4. **Result redaction noise.** The gateway's sensitive-content validator redacted CPE `firmware` version strings in the audit result summary. A per-tool allowlist or a clearer heuristic would help ops data.
