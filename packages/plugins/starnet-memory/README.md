# @starnet/plugin-memory (`starnet.memory`)

Starnet-owned Paperclip plugin: **curated memory** for agents. Instead of sending the whole chat /
issue history to a model, an agent pulls a small, bounded *context pack* (`<starnet-context v="1">`).

No Paperclip core files are changed. Everything uses the public plugin SDK.

## What it does

| Piece | How |
|---|---|
| Storage | Plugin DB namespace (`migrations/001_starnet_memory.sql`): `memory_items`, `session_l1`, `bundle_log`, `admission_log` (no text) |
| L1 session memory | Hooks `agent.run.finished/failed/cancelled` → deterministic summary (`@starnet/memory-core`) per **agent+issue** and per **agent**. Observe-only. |
| Pins | Board comment `catat: …`, `📌 …`, `/pin …`, `pin: …`, `ingat: …` → curated item (agent scope; company scope if the issue has no assignee). Board can also add notes in the UI. |
| Write filter | `admit()` from memory-core: secrets scrubbed, secret-only / raw transcripts / oversized rejected (never stored), poisoning quarantined (never in a pack until a board user approves) |
| Context pack | `GET /api/plugins/starnet.memory/api/context/:issueId?tools=a,b` (agent auth, run checkout required) and tool `memory.get_context_bundle`. Also `memory.recall`, `memory.create_note` (agent notes are ephemeral at most). |
| Savings | Every pack is logged with its size and the size of a naive history dump (this issue's thread + the last 24 comments on the agent's other issues, lengths only). |
| UI | Page "Memori", sidebar link, **Memori** tab on issue and agent detail, dashboard widget. Live via plugin stream `memory` (polling fallback). |

## Limits

- A plugin cannot inject text into another adapter's prompt. Agents **pull** the pack (route or tool).
  The core prompt is unchanged; the full saving arrives with the Starnet runtime adapter (Phase 2).
- The worker cannot see the tool gateway's grant list for a run, so the caller passes `?tools=`.
- Host UI: the agent detail page does not render plugin `detailTab` slots yet, so the Memory page has a
  per-agent view ("Memori per agen"). The issue **Memori** tab is visible only with the classic task
  interface (instance experimental setting); the default chat view hides the tab strip.
- A board comment on a finished issue that has an assignee reopens it (core behaviour). Put board facts on
  an unassigned issue, an open issue, or use the form in the Memory UI.
- A bundle carries at most 4 pins (issue > agent > project > company).

## Dev

```sh
pnpm --filter @starnet/plugin-memory typecheck
pnpm --filter @starnet/plugin-memory test
pnpm --filter @starnet/plugin-memory build
```
