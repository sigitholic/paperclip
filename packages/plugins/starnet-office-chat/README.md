# Starnet Office Chat (`starnet.office-chat`)

A company-level chat page (`/<company>/office-chat`, with a sidebar link) where the operator talks to "the office".
It is built from Paperclip primitives only. There is no parallel task system and no core edits.

| Chat step | Paperclip primitive |
| --- | --- |
| Operator message that is a request | `ctx.issues.create`, which creates an issue assigned to the chosen agent (`originKind: plugin:starnet.office-chat`, `originId`: chat message id) |
| Get the agent working | `ctx.issues.requestWakeup` (plugin-created issues are **not** auto-woken, unlike the REST route) |
| Agent progress | `agent.run.started/failed/cancelled` events are shown as short office notes |
| Agent reply | `issue.comment.created` → `ctx.issues.listComments` → agent bubble (only for issues the chat created) |
| Status | `issue.updated` → "STA-14 selesai ✅" |

- **Role isolation.** The issue description contains only that one request (`taskBrief`). The agent never sees the chat transcript or other agents' tasks.
- **Routing.** `src/router.ts` handles routing: an `@Name` mention, then domain keyword rules (NOC, finance, support), then word overlap with the agent's own name, title and capabilities. Anything else gets a reply and **no** issue is created.
  - **LLM hook:** implement `ChatRouter` (same input and output) and call `createOfficeChat(myLlmRouter)` in `worker.ts`.
- **State.** The thread lives in plugin state (company scope, key `thread`, last 300 messages). Updates are serialized per company with `serialByKey` from `@starnet/pack-kit`.
- **UI.** `usePluginData("thread")` + `usePluginAction("send")`.
  - Live updates come from `usePluginStream("chat")`: the worker emits `{type:"thread.changed"}` and the page re-reads `thread`. While the stream is connected there is **no polling** (`data-live="stream"`).
  - A 2.5 s refresh runs **only as a fallback** when the stream fails or is unsupported (`data-live="polling"`, e.g. upstream builds where the bridge still returns 501). On `starnet/main` the bridge is wired by core patch #1 in `STARNET_PATCHES.md`.

## Paperclip plugin SDK map (what we evaluated)

- **UI slots (17).**
  - `page`, `detailTab`, `taskDetailView`, `dashboardWidget`, `sidebar`, `routeSidebar`, `sidebarPanel`, `projectSidebarItem`
  - `globalToolbarButton`, `appShellOverlay`, `organizationSwitcher`, `toolbarButton`, `contextMenuItem`
  - `commentAnnotation`, `commentContextMenuItem`, `settingsPage`, `companySettingsPage`
  - We use `page` + `sidebar` (and `dashboardWidget` in Virtual Office).
- **UI hooks.**
  - `usePluginData` / `usePluginAction`: bridge to the worker's `getData` / `performAction`.
  - `usePluginStream`: SSE `/api/plugins/:id/bridge/stream/:channel` (not wired upstream yet; wired on `starnet/main` by core patch #1).
  - `useHostContext`, `useHostNavigation`, `useHostLocation`, `usePluginToast`.
  - Host components such as `MarkdownBlock` (used for agent replies).
- **Events (observe-only).** 33 domain events, e.g. `issue.*`, `issue.comment.created`, `agent.run.*`, `agent.status_changed`, `approval.*`, `activity.logged`. They are delivered asynchronously to the worker. Handlers cannot block or modify core actions.
- **Chat sessions** (`agent.sessions.*`): a direct 1:1 prompt → agent run with streamed events. **Not used** here on purpose, because it bypasses issues, assignments and the audit trail. It is a candidate for "quick question" replies later.
- **Other.** Plugin data and actions endpoints (`POST /api/plugins/:id/data/:key`, `/actions/:key`), plugin state, managed agents and routines, tools (see `starnet-pack-isp`).

## Develop

```
pnpm --filter @starnet/plugin-office-chat typecheck
pnpm --filter @starnet/plugin-office-chat test     # router + thread mapping + harness E2E
pnpm --filter @starnet/plugin-office-chat build
paperclipai plugin install ./packages/plugins/starnet-office-chat
```

Capabilities it needs: `agents.read`, `issues.read`, `issues.create`, `issues.wakeup`, `issue.comments.read`, `events.subscribe`, `plugin.state.*`, `ui.page.register`, `ui.sidebar.register`.
