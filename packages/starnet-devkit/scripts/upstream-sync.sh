#!/usr/bin/env bash
# Weekly upstream sync: merge paperclipai/paperclip master into starnet/main on a branch,
# regenerate the lockfile, run the Starnet checks, and (optionally) push + open a fork PR.
#
# Usage: packages/starnet-devkit/scripts/upstream-sync.sh [--push] [--pr] [--no-checks] [--server-tests]
#   --push          push the sync branch to origin (the fork)
#   --pr            open a PR sigitholic/paperclip:starnet/main <- starnet/sync-YYYYMMDD (draft if
#                   conflicts or failed checks); never touches the upstream repo
#   --no-checks     skip typecheck/test (conflict triage only)
#   --server-tests  also run the P-0 server regression tests
# Env: BASE_BRANCH (starnet/main), UPSTREAM_REF (upstream/master), FORK_REPO (sigitholic/paperclip)
# Exit: 0 synced/up to date, 2 conflicts (branch left with markers committed when --pr), 3 checks failed.
set -uo pipefail
# The script checks out other branches; run from a temp copy so bash never reads a changed file.
if [ -z "${STARNET_SYNC_REEXEC:-}" ]; then
  tmp=$(mktemp -t starnet-sync.XXXXXX.sh); cp "$0" "$tmp"
  STARNET_SYNC_REEXEC=1 exec bash "$tmp" "$@"
fi
unset DATABASE_URL # box trap: never let child processes see the shared Postgres URL

BASE_BRANCH=${BASE_BRANCH:-starnet/main}
UPSTREAM_REF=${UPSTREAM_REF:-upstream/master}
FORK_REPO=${FORK_REPO:-sigitholic/paperclip}
PUSH=0; PR=0; CHECKS=1; SERVER_TESTS=0
for a in "$@"; do case "$a" in
  --push) PUSH=1 ;; --pr) PR=1; PUSH=1 ;; --no-checks) CHECKS=0 ;; --server-tests) SERVER_TESTS=1 ;;
  *) echo "unknown option: $a" >&2; exit 64 ;;
esac; done

ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
REPORT_DIR="$ROOT/packages/starnet-devkit/.state"; mkdir -p "$REPORT_DIR"
REPORT="$REPORT_DIR/sync-report.md"
say() { echo "[sync] $*"; }

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then echo "working tree not clean; commit or stash first" >&2; exit 65; fi
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/paperclipai/paperclip.git
git fetch -q upstream master && git fetch -q origin "$BASE_BRANCH" || { echo "fetch failed" >&2; exit 66; }

BEHIND=$(git rev-list --count "origin/$BASE_BRANCH..$UPSTREAM_REF")
UP_SHA=$(git rev-parse --short=10 "$UPSTREAM_REF")
OLD_BASE=$(git merge-base "origin/$BASE_BRANCH" "$UPSTREAM_REF" | cut -c1-10)
if [ "$BEHIND" = 0 ]; then say "up to date with $UPSTREAM_REF ($UP_SHA)"; exit 0; fi

BR="starnet/sync-$(date +%Y%m%d)"
say "$BEHIND upstream commit(s) $OLD_BASE..$UP_SHA -> $BR"
git checkout -q -B "$BR" "origin/$BASE_BRANCH"

CONFLICTS=""
if ! git merge --no-ff --no-edit -m "chore(sync): merge upstream master $UP_SHA into $BASE_BRANCH" "$UPSTREAM_REF" >/dev/null 2>&1; then
  CONFLICTS=$(git diff --name-only --diff-filter=U)
  # The lockfile is regenerated, never hand-merged.
  if echo "$CONFLICTS" | grep -qx "pnpm-lock.yaml"; then
    git checkout --theirs pnpm-lock.yaml && git add pnpm-lock.yaml
    CONFLICTS=$(git diff --name-only --diff-filter=U)
  fi
  if [ -z "$CONFLICTS" ]; then
    git commit -q --no-edit
  fi
fi

{
  echo "## Upstream sync $(date +%Y-%m-%d)"
  echo
  echo "- Upstream: \`$UPSTREAM_REF\` $OLD_BASE → **$UP_SHA** ($BEHIND commit(s))"
  echo "- Branch: \`$BR\` → base \`$BASE_BRANCH\`"
  echo
  echo "<details><summary>Upstream commits</summary>"
  echo
  git log --no-merges --format='- %h %s' "$OLD_BASE..$UPSTREAM_REF" | head -200
  echo
  echo "</details>"
  echo
} > "$REPORT"

if [ -n "$CONFLICTS" ]; then
  say "CONFLICTS:"; echo "$CONFLICTS" | sed 's/^/  - /'
  { echo "### ⚠️ Conflicts (resolve on this branch)"; echo; echo "$CONFLICTS" | sed 's/^/- `/; s/$/`/'; echo;
    echo "Resolve locally: \`git fetch origin && git checkout $BR\`, resolve ONLY by keeping upstream code plus the approved P-0 streaming patch (no other core edits; if that is not possible, stop and report), keep STARNET_PATCHES.md accurate, run the checks, push."; } >> "$REPORT"
  if [ "$PR" = 1 ]; then
    git add -A && git commit -q --no-verify -m "chore(sync): merge upstream $UP_SHA (UNRESOLVED CONFLICTS)"
    git push -q -u origin "$BR"
    gh pr create --repo "$FORK_REPO" --base "$BASE_BRANCH" --head "$BR" --draft \
      --title "chore(sync): upstream $UP_SHA → $BASE_BRANCH (conflicts)" --body-file "$REPORT"
  else
    say "merge left in progress on $BR for manual resolution (report: $REPORT)"
  fi
  exit 2
fi

# Lockfile: regenerate from the merged package.json files.
export PATH="${PNPM_NODE_BIN:+$PNPM_NODE_BIN:}$PATH"
pnpm install --no-frozen-lockfile --prefer-offline >/tmp/starnet-sync-install.log 2>&1 || { tail -30 /tmp/starnet-sync-install.log; echo "pnpm install failed" >&2; exit 3; }
if ! git diff --quiet pnpm-lock.yaml; then git add pnpm-lock.yaml && git commit -q -m "chore(sync): regenerate pnpm-lock.yaml"; echo "- Lockfile regenerated" >> "$REPORT"; fi

FAILED=""
run() { local name=$1; shift; say "check: $name"; if "$@" >/tmp/starnet-sync-check.log 2>&1; then echo "- ✅ $name" >> "$REPORT"; else echo "- ❌ $name" >> "$REPORT"; tail -40 /tmp/starnet-sync-check.log; FAILED="$FAILED $name"; fi; }
echo "### Checks" >> "$REPORT"
run "no core edits beyond P-0 (core-diff-check)" node packages/starnet-devkit/scripts/core-diff-check.mjs --against "$UPSTREAM_REF"
if [ "$CHECKS" = 1 ]; then
  F=(--filter "./packages/plugins/starnet-*" --filter "./packages/starnet-*" --filter "./packages/adapters/starnet-*")
  run "build plugin SDK" pnpm --filter "@paperclipai/plugin-sdk..." build
  run "typecheck Starnet packages" pnpm "${F[@]}" --workspace-concurrency=1 run typecheck
  run "test Starnet packages" pnpm "${F[@]}" run test
  run "build Starnet packages" pnpm "${F[@]}" --workspace-concurrency=1 run build
  run "repo boundary checks" bash -c "node scripts/check-forbidden-tokens.mjs && node scripts/check-module-boundaries.mjs && node scripts/check-token-gates.mjs"
  [ "$SERVER_TESTS" = 1 ] && run "P-0 server tests" bash -c "cd server && npx vitest run src/__tests__/plugin-stream-bridge.test.ts src/__tests__/plugin-routes-authz.test.ts"
fi
{ echo; echo "### Core files changed vs upstream (only the P-0 files are allowed)"; echo; node packages/starnet-devkit/scripts/core-diff-check.mjs --against "$UPSTREAM_REF" 2>&1 | sed 's/^/    /'; } >> "$REPORT"
NEW_WF=$(git diff --name-only --diff-filter=A "$OLD_BASE" "$UPSTREAM_REF" -- .github/workflows)
[ -n "$NEW_WF" ] && { echo; echo "### New upstream workflows — disable in the fork (\`gh workflow disable <file> --repo $FORK_REPO\`)"; echo "$NEW_WF" | sed 's/^/- /'; } >> "$REPORT"
MIGRATIONS=$(git diff --name-only --diff-filter=A "$OLD_BASE" "$UPSTREAM_REF" -- 'packages/db/src/migrations/*' | head -20)
[ -n "$MIGRATIONS" ] && { echo; echo "### New DB migrations (run the local instance via /workspace/paperclip-start.sh, then the devkit E2E)"; echo "$MIGRATIONS" | sed 's/^/- /'; } >> "$REPORT"

say "report: $REPORT"
if [ "$PUSH" = 1 ]; then git push -q -u origin "$BR"; fi
if [ "$PR" = 1 ]; then
  DRAFT=(); [ -n "$FAILED" ] && DRAFT=(--draft)
  gh pr create --repo "$FORK_REPO" --base "$BASE_BRANCH" --head "$BR" "${DRAFT[@]}" \
    --title "chore(sync): upstream $UP_SHA → $BASE_BRANCH ($(date +%Y-%m-%d))" --body-file "$REPORT"
  # PRs opened with the Actions GITHUB_TOKEN do not trigger pull_request workflows; dispatch CI explicitly.
  [ -n "${GITHUB_ACTIONS:-}" ] && gh workflow run starnet-ci.yml --repo "$FORK_REPO" --ref "$BR" || true
fi
[ -n "$FAILED" ] && { say "checks failed:$FAILED"; exit 3; }
say "done"
