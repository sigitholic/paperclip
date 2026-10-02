# Starnet Office Templates (`starnet.office-templates`)

One-click offices at `/<company>/install-office` (sidebar link "Install Office"). Four templates ship today:

| Office | Head (role) | Members | Routine (Asia/Jakarta, starts paused) |
|---|---|---|---|
| Network (ISP/NOC) | NOC Manager (`devops`) | Network Engineer, MikroTik Specialist, Network QA | Weekly network report, Mon 08:00 |
| Software | Product Manager (`pm`) | Software Architect, Backend Engineer, Frontend Engineer, Software QA | Weekly sprint review, Fri 16:00 |
| Marketing | Marketing Manager (`cmo`) | Content Writer, Social Media Specialist, Growth Analyst | Weekly marketing report, Mon 09:00 |
| Finance | Finance Manager (`cfo`) | Billing Specialist, Accounting Staff, Finance Analyst | Monthly finance report, 1st 09:00 |

Each office also gets a project owned by its head.

## How it installs (no core change)

The page builds an `agentcompanies/v1` package in the browser (`src/package-builder.ts`) and sends it to the existing
host import API under the board session: `POST /api/companies/:id/imports/preview`, then `/imports/apply`. The page
calls the same endpoints that company import uses, so it gets the host's checks, activity log (`company.imported`) and
collision handling.

- **Drafts, not grants.** New agents get `canCreateAgents: false`, `canCreateSkills: false`, and no tool profile.
  The import runs with `pauseAutomations: true`, so agents and the routine arrive **paused**. The board then grants
  tools and resumes them.
- **Re-install is safe.** `collisionStrategy: "skip"` leaves existing agents and projects untouched.
- **No timer heartbeat.** `runtime.heartbeat.enabled: false`: agents wake on assignment, not on a clock.
- **Engine.** The adapter type and config are copied from an agent the board picks. Secret references are kept. Plain
  values the host redacts in API responses (`***REDACTED***`) are dropped and listed so they are never saved as the
  marker. Per-agent wiring (`starnetQaReviewer`, instruction paths) is left out. `process`/`http` agents cannot be
  sources, because the safe importer rejects them.
- **Reporting line.** The office head reports to the agent the board picks (default: the live `ceo`) via
  `reportsToExistingAgentId`. Other members report to the head.

The host parser reads a YAML subset, so every frontmatter and `.paperclip.yaml` value is written as one-line JSON.
`COMPANY.md` is mandatory for the importer even when `include.company` is false.

The worker only reports health: it holds no board credentials.

```
pnpm --filter @starnet/plugin-office-templates typecheck
pnpm --filter @starnet/plugin-office-templates test
pnpm --filter @starnet/plugin-office-templates build
paperclipai plugin install ./packages/plugins/starnet-office-templates
```
