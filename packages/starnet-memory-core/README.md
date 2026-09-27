# @starnet/memory-core

Pure Starnet Memory logic: no I/O, no clock, no LLM. Used by the `starnet.memory` plugin, and later by the Starnet runtime (Phase 2) and Office Chat.

Design: `starnet-memory-v1` brief (layers L0–L4, **default: do not write**, deterministic summarizer), mapped to Paperclip objects in the Starnet implementation plan §4.

## API

| Function | What it does |
|---|---|
| `admit(text, kind, source)` | Write admission → `curated \| ephemeral \| quarantine \| reject`, plus scrubbed text and reasons. |
| `scrubSecrets(text)` | Replaces private keys, JWTs, URL credentials, provider tokens, bearer tokens and `password=`/`token:`/`kata sandi adalah …` values with `[REDACTED:<type>]`. Idempotent. |
| `detectPoison(text)` / `looksLikeTranscript(text)` | Prompt-injection signals (English + Indonesian) / pasted chat or JSON message logs. |
| `parsePinCommand(body)` | Board comment `📌 …`, `catat: …`, `pin: …`, `ingat: …`, `/pin …` → note text. |
| `summarizeL1(prev, runOutcome)` | Deterministic L1 session summary (≤ 480 chars): status line, one-line result, `Kendala:`, `Keputusan:` (new, then carried over), `Next:`. Idempotent per run id. |
| `buildBundle(input, budgets)` | Curated context bundle in a `<starnet-context v="1">` wrapper with sections Tugas / Handoff / Tool / L1 / Pins / Memori terkait. |
| `compareToNaive(naive, bundle)` | Chars and estimated tokens saved versus sending the whole transcript. |

### Admission rules

- **reject**: empty, transcript (≥ 3 role/timestamp-speaker lines or ≥ 2 JSON `role` entries), longer than 1,200 chars, or nothing left after removing secrets.
- **quarantine**: any poison signal (ignore/abaikan instructions, role hijack, system prompt / jailbreak, secret exfiltration, chat markup, tool coercion) or hidden zero-width/bidi characters. Stored for operator review, **never** placed in a bundle.
- **curated**: board decisions, approvals, pins, lessons, failures and notes; system summaries.
- **ephemeral**: everything else (agent and chat writes). A board user can promote it later.
- Secrets are always scrubbed from the stored text.

### Bundle budgets (`BUNDLE_BUDGETS`)

`total 5500` chars; task 900; handoff 6 lines × 160; tools 20 / 600 chars; L1 480; pins 4 × 280; hits 3 × 320.
Only `curated` pins are used; `quarantine` items and anything that trips `detectPoison` are filtered.
When over the total, sections are dropped in this order: hits, then handoff, then tools. After that the task description is shortened. Task title, L1 and pins are never dropped. The output never exceeds `total`.
Wrapper tags inside content are neutralised, and content is secret-scrubbed again (defence in depth).

## Develop

```
pnpm --filter @starnet/memory-core typecheck
pnpm --filter @starnet/memory-core test   # node:test + built-in coverage; fails below 90 % lines/functions, 85 % branches
```

Tests use `node:test` (no extra dependencies), so the workspace lockfile does not change.
