# Starnet Virtual Office (`starnet.virtual-office`)

Agents shown as desks at `/<company>/virtual-office`, plus a sidebar link and a dashboard widget. Status is **derived only from real Paperclip state and events**:

- **busy / idle / paused / error / away** come from the core agent status. The heartbeat service sets `running` for the whole duration of a run.
- **Which run, which issue, since when** come from `agent.run.started` (payload `runId`, `issueId`, `startedAt`) and `issue.checked_out`.
- **Last activity / last run** come from `agent.run.finished|failed|cancelled`, `issue.comment.created` and `lastHeartbeatAt`.
- **No event means idle.** A missed "finished" event never leaves a ghost "busy" desk, because the core status wins.

There is no animation state: the desk screen is simply coloured by state.

The pure mapping (`applyEvent`, `deriveDesk`) is in `src/presence.ts` and unit-tested.

The worker keeps presence plus the last 30 events in plugin state (company scope, key `office`). Data endpoint: `office` → `{ counts, desks[], log[] }`.

Live updates use `usePluginStream("office")` when the host stream bridge is available. On this Paperclip build it returns 501, so the UI falls back to a 2.5 s refresh (see `STARNET_PATCHES.md`).

```
pnpm --filter @starnet/plugin-virtual-office typecheck
pnpm --filter @starnet/plugin-virtual-office test
pnpm --filter @starnet/plugin-virtual-office build
paperclipai plugin install ./packages/plugins/starnet-virtual-office
```
