# Starnet Virtual Office (`starnet.virtual-office`)

Agents shown as desks at `/<company>/virtual-office`, plus a sidebar link and a dashboard widget. Status is **derived only from real Paperclip state and events**:

- **busy / idle / paused / error / away** come from the core agent status. The heartbeat service sets `running` for the whole duration of a run.
- **Which run, which issue, since when** come from `agent.run.started` (payload `runId`, `issueId`, `startedAt`) and `issue.checked_out`.
- **Last activity / last run** come from `agent.run.finished|failed|cancelled`, `issue.comment.created` and `lastHeartbeatAt`.
- **No event means idle.** A missed "finished" event never leaves a ghost "busy" desk, because the core status wins.

There is no animation state: the desk screen is simply coloured by state.

The pure mapping (`applyEvent`, `deriveDesk`) is in `src/presence.ts` and unit-tested.

The worker keeps presence plus the last 30 events in plugin state (company scope, key `office`). Data endpoint: `office` → `{ counts, desks[], log[] }`.

Live updates come from `usePluginStream("office")`: every event emits `{type:"office.changed"}` and the page re-reads `office`. While the stream is connected there is **no polling** (`data-live="stream"`). Core publishes `agent.run.*` a few hundred ms *before* it flips the agent status back to idle (and emits no event for that flip), so after a terminal run event the worker re-announces `office.changed` (`eventType:"settle"`) at +1.5 s and +5 s.

A 2.5 s refresh runs **only as a fallback** when the stream fails or is unsupported (`data-live="polling"`, e.g. upstream builds where the bridge still returns 501). On `starnet/main` the bridge is wired by core patch #1 in `STARNET_PATCHES.md`.

```
pnpm --filter @starnet/plugin-virtual-office typecheck
pnpm --filter @starnet/plugin-virtual-office test
pnpm --filter @starnet/plugin-virtual-office build
paperclipai plugin install ./packages/plugins/starnet-virtual-office
```
