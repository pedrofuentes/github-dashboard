#!/usr/bin/env bash
# tick.sh — the watchdog's read-only fact reporter (autonomous-kickoff).
#
# WHAT THIS IS. Each watchdog tick runs this script FIRST (see
# docs/CONTINUOUS-OPERATION.md, Tier 1 preamble). It computes the mechanical
# facts the tick steps consume and emits ONE JSON object on stdout. It is a
# REPORTER, never an actor: it must not claim, merge, label, comment, or post.
# The prose steps 0-9 remain the contract; this script only saves the lookups.
#
# FAIL CLOSED ON DATA. Any datum this script cannot produce is reported as
# "unknown" (with an entry in .errors) — and "unknown" NEVER counts as clear,
# green, or clean. dod_met is true only when every sub-boolean is
# affirmatively true. Exit code 0 = a report was produced (findings live in
# the JSON); non-zero = no trustworthy report at all.
#
# HARNESS INTEGRITY. This file is a protected path (MISSION.md section 9): a
# PR that edits it to always report "clear" has neutered the watchdog's eyes,
# so changes to it are human-required and never auto-merge.
#
# DEPENDENCIES. bash + gh (with its built-in --jq) + git + shasum. Nothing
# project-specific: the two project-specific DoD sub-booleans (acceptance,
# deploy_verified) are delegated to an OPTIONAL consumer-authored hook,
# scripts/dod-check.sh, which prints two lines:
#   acceptance=true|false
#   deploy_verified=true|false
# (the DevOps sub-agent writes that hook from MISSION.md section 8 during the
# build). Absent hook => "unknown".
#
# USAGE:
#   bash scripts/tick.sh --agent-login <agent-identity> --cofounder-login <handle>
#
# NOTE: set -e is deliberately absent — a failed probe must record "unknown"
# and continue, never abort the report.
set -uo pipefail

AGENT_LOGIN=""
COFOUNDER_LOGIN=""
PLAN_FILE="PLAN.md"
STALE_SECONDS=3600   # ~2 missed 15-min heartbeat intervals + slack; override with --stale-seconds
while [ $# -gt 0 ]; do
  case "$1" in
    --agent-login) AGENT_LOGIN=${2:-}; shift 2 ;;
    --cofounder-login) COFOUNDER_LOGIN=${2:-}; shift 2 ;;
    --plan) PLAN_FILE=${2:-PLAN.md}; shift 2 ;;
    --stale-seconds) STALE_SECONDS=${2:-3600}; shift 2 ;;
    *) shift ;;
  esac
done

# ISSUE_LIMIT — gh issue list defaults to 30, which silently truncates a real
# mid-build board and would manufacture false gate-parity drift. 500 covers any
# sane board; a board larger than that should page via gh api instead.
ISSUE_LIMIT=500

ERRORS=()
err() { ERRORS+=("$1"); }

# g — run gh quietly; caller checks the exit code and records "unknown" on failure.
g() { gh "$@" 2>/dev/null; }

# nums_to_json — newline-separated numbers on stdin -> a JSON array (always valid, "[]" when empty).
nums_to_json() {
  local joined
  joined=$(sed '/^$/d' | paste -sd, - 2>/dev/null || true)
  printf '[%s]' "$joined"
}

# sha256 — portable digest (macOS ships shasum, slim Linux images only sha256sum).
sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256; else sha256sum; fi | cut -d' ' -f1
}
TAB=$(printf '\t')

# Resolve the repo root + slug; without a repo there is no trustworthy report.
root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo '{"tick_report":"v1","fatal":"not a git repository"}'; exit 1; }
cd "$root" || exit 1
REPO=$(g repo view --json nameWithOwner --jq .nameWithOwner) || { echo '{"tick_report":"v1","fatal":"gh cannot resolve the repo (auth? remote?)"}'; exit 1; }
OWNER=${REPO%%/*}
NAME=${REPO#*/}

TEMPLATE_VERSION="unknown"
[ -f docs/VERSION ] && TEMPLATE_VERSION=$(tr -d '[:space:]' < docs/VERSION)

# ---------------------------------------------------------------- 0. halt --
HALT_STATE='"unknown"'; HALT_ISSUES='[]'
if out=$(g issue list --label agent:halt --state open --limit "$ISSUE_LIMIT" --json number --jq '[.[].number]'); then
  HALT_ISSUES=$out
  if [ "$out" = "[]" ]; then HALT_STATE='"clear"'; else HALT_STATE='"halted"'; fi
else
  err "halt: could not list agent:halt issues"
fi

# --------------------------------------------------------------- 1. board --
# A missing/unlinked board is the top drift finding: the only permitted work
# that tick is restoring the board (docs/CONTINUOUS-OPERATION.md step 1).
# Honest bounds on these facts: exists/linked_to_repo are the same observation
# (a Projects-v2 board is only visible here once linked); control_issue_pinned
# is true when ANY issue is pinned (the control issue is the pinned one by
# convention — exact identification is agent judgment); status_options_ok
# greps the linked projects' Status options for "Blocked" + "Pending Decision".
BOARD_EXISTS='"unknown"'; BOARD_LINKED='"unknown"'; CONTROL_PINNED='"unknown"'; STATUS_OPTIONS_OK='"unknown"'
PROJECT_NUMBER=""
board_q='query($o:String!,$r:String!){repository(owner:$o,name:$r){projectsV2(first:5){nodes{number title field(name:"Status"){... on ProjectV2SingleSelectField{options{name}}}}}pinnedIssues(first:5){nodes{issue{number}}}}}'
if out=$(g api graphql -f query="$board_q" -f o="$OWNER" -f r="$NAME"); then
  # gh's --jq only post-processes gh output per call; parse the compact JSON with grep/sed here.
  if printf '%s' "$out" | grep -q '"projectsV2":{"nodes":\[\]'; then
    BOARD_EXISTS='false'; BOARD_LINKED='false'
  else
    BOARD_EXISTS='true'; BOARD_LINKED='true'
    PROJECT_NUMBER=$(printf '%s' "$out" | sed -n 's/.*"projectsV2":{"nodes":\[{"number":\([0-9]*\).*/\1/p')
    if printf '%s' "$out" | grep -q '"name":"Blocked"' && printf '%s' "$out" | grep -q '"name":"Pending Decision"'; then
      STATUS_OPTIONS_OK='true'
    else
      STATUS_OPTIONS_OK='false'
    fi
  fi
  if printf '%s' "$out" | grep -q '"pinnedIssues":{"nodes":\[\]'; then CONTROL_PINNED='false'; else CONTROL_PINNED='true'; fi
else
  err "board: projectsV2/pinnedIssues GraphQL query failed (scope?)"
fi

# --------------------------------------------------------- 2. gate parity --
# PLAN.md HANDOFF '### Gates' lines must match the board's open gate set,
# both directions, with each recorded body-sha256 intact.
GP_OK='"unknown"'; GP_HANDOFF_ONLY='[]'; GP_BOARD_ONLY='[]'; GP_HASH_MISMATCH='[]'
board_gates=""
if bg=$(g issue list --state open --limit "$ISSUE_LIMIT" --json number,labels --jq '[.[] | select([.labels[].name] | map(. == "needs:decision" or . == "blocked") | any) | .number] | sort'); then
  board_gates=$(printf '%s' "$bg" | tr -d '[] ' | tr ',' '\n' | sed '/^$/d')
  if [ ! -f "$PLAN_FILE" ]; then
    err "gate_parity: $PLAN_FILE not found"
  else
    handoff_lines=$(awk '/^### Gates/{f=1;next} /^#/{f=0} f && /^- #/' "$PLAN_FILE")
    handoff_gates=$(printf '%s\n' "$handoff_lines" | sed -n 's/^- #\([0-9]*\).*/\1/p' | sort -n | sed '/^$/d')
    ho=$(comm -23 <(printf '%s\n' "$handoff_gates" | sed '/^$/d' | sort) <(printf '%s\n' "$board_gates" | sed '/^$/d' | sort))
    bo=$(comm -13 <(printf '%s\n' "$handoff_gates" | sed '/^$/d' | sort) <(printf '%s\n' "$board_gates" | sed '/^$/d' | sort))
    GP_HANDOFF_ONLY=$(printf '%s\n' "$ho" | nums_to_json)
    GP_BOARD_ONLY=$(printf '%s\n' "$bo" | nums_to_json)
    mism=""
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      num=$(printf '%s' "$line" | sed -n 's/^- #\([0-9]*\).*/\1/p')
      want=$(printf '%s' "$line" | sed -n 's/.*body-sha256:\([0-9a-fA-F]*\).*/\1/p')
      if [ -z "$num" ] || [ -z "$want" ]; then
        err "gate_parity: malformed Gates line (missing #issue or body-sha256): $line"
        continue
      fi
      # Recipe (pinned in CONTINUOUS-OPERATION.md §Lead continuity): hash the API
      # body bytes — gh issue view <n> --json body --jq .body — same as at raise time.
      if body=$(g issue view "$num" --json body --jq .body); then
        have=$(printf '%s' "$body" | sha256)
        [ "$have" = "$want" ] || mism="$mism $num"
      else
        err "gate_parity: could not fetch body of #$num for hash check"
      fi
    done <<EOF
$handoff_lines
EOF
    GP_HASH_MISMATCH=$(printf '%s\n' $mism | nums_to_json)
    if [ "$GP_HANDOFF_ONLY" = "[]" ] && [ "$GP_BOARD_ONLY" = "[]" ] && [ "$GP_HASH_MISMATCH" = "[]" ]; then GP_OK='true'; else GP_OK='false'; fi
  fi
else
  err "gate_parity: could not list open gate-labeled issues"
fi

# -------------------------------------------------------- 3. status drift --
# Status is the visual mirror; with project scope present a lagging column is
# drift. Without project data this whole block is "unknown" (labels rule).
STATUS_DRIFT='"unknown"'
if [ -n "$PROJECT_NUMBER" ]; then
  if items=$(g project item-list "$PROJECT_NUMBER" --owner "$OWNER" --format json --limit 200 --jq '[.items[] | select(.content.number != null) | {n: .content.number, s: (.status // "none")}]'); then
    if gate_status=$(g issue list --state open --limit "$ISSUE_LIMIT" --json number,labels --jq '[.[] | {n: .number, want: (if ([.labels[].name] | index("blocked")) then "Blocked" elif ([.labels[].name] | index("needs:decision")) then "Pending Decision" elif ([.labels[].name] | map(startswith("claimed:")) | any) then "In Progress" else "" end)} | select(.want != "")]'); then
      # gh --jq only filters gh output; join the two lists here in bash.
      STATUS_DRIFT="[]"
      while IFS=$'\t' read -r n want; do
        [ -z "$n" ] && continue
        s=$(printf '%s' "$items" | tr '{' '\n' | grep "\"n\":$n," | sed -n 's/.*"s":"\([^"]*\)".*/\1/p' | head -1)
        [ -z "$s" ] && s="none"
        if [ "$s" != "$want" ]; then
          entry=$(printf '{"issue":%s,"labels_say":"%s","status_says":"%s"}' "$n" "$want" "$s")
          if [ "$STATUS_DRIFT" = "[]" ]; then STATUS_DRIFT="[$entry]"; else STATUS_DRIFT="${STATUS_DRIFT%]}",$entry"]"; fi
        fi
      done < <(printf '%s' "$gate_status" | tr '{' '\n' | sed -n "s/.*\"n\":\([0-9]*\),\"want\":\"\([^\"]*\)\".*/\1${TAB}\2/p")
    else
      err "status_drift: could not compute expected Status from labels"
    fi
  else
    err "status_drift: project item-list failed (project scope?)"
  fi
else
  err "status_drift: no linked project number available"
fi

# ------------------------------------------------------------ 4. reconcile --
UNTRIAGED='"unknown"'; CLOSE_SWEEP='"unknown"'
if out=$(g issue list --state open --limit "$ISSUE_LIMIT" --json number,labels --jq '[.[] | select(([.labels[].name] | map(. == "bug:confirmed" or . == "polish" or . == "stale" or . == "needs:decision" or . == "blocked" or . == "security" or . == "ready" or startswith("claimed:") or startswith("sentinel:")) | any) | not) | .number]'); then
  UNTRIAGED=$out
else
  err "reconcile: untriaged scan failed"
fi
if refs=$(g pr list --state merged --limit 20 --json number,body --jq '[.[] | {pr: .number, refs: [(.body // "" | scan("#[0-9]+"))]} | select((.refs | length) > 1)]'); then
  CLOSE_SWEEP="[]"
  while IFS=$'\t' read -r pr n; do
    [ -z "$n" ] && continue
    if st=$(g issue view "$n" --json state --jq .state); then
      if [ "$st" = "OPEN" ]; then
        entry=$(printf '{"pr":%s,"open_ref":%s}' "$pr" "$n")
        if [ "$CLOSE_SWEEP" = "[]" ]; then CLOSE_SWEEP="[$entry]"; else CLOSE_SWEEP="${CLOSE_SWEEP%]}",$entry"]"; fi
      fi
    else
      err "reconcile: close-sweep could not fetch state of #$n (referenced by PR #$pr)"
    fi
  done < <(printf '%s' "$refs" | tr '{' '\n' | sed -n 's/.*"pr":\([0-9]*\).*/\1/p' | while read -r pr; do
      printf '%s' "$refs" | tr '{' '\n' | grep "\"pr\":$pr," | grep -oE '#[0-9]+' | tr -d '#' | sort -u | sed "s/^/$pr${TAB}/"
    done)
else
  err "reconcile: merged-PR close-sweep scan failed"
fi

# ------------------------------------------------------------- 5. security --
SEC_DEP='"unknown"'; SEC_CODE='"unknown"'; SEC_SECRET='"unknown"'; SEC_ISSUES='"unknown"'
if out=$(g api "repos/$REPO/dependabot/alerts?state=open&per_page=100" --jq '[.[] | select(.security_advisory.severity == "high" or .security_advisory.severity == "critical")] | length'); then SEC_DEP=$out; else err "security: dependabot alerts unreadable"; fi
if out=$(g api "repos/$REPO/code-scanning/alerts?state=open&per_page=100" --jq '[.[] | select(.rule.security_severity_level == "high" or .rule.security_severity_level == "critical")] | length'); then SEC_CODE=$out; else err "security: code-scanning alerts unreadable"; fi
if out=$(g api "repos/$REPO/secret-scanning/alerts?state=open&per_page=100" --jq 'length'); then SEC_SECRET=$out; else err "security: secret-scanning alerts unreadable"; fi
if out=$(g issue list --state open --label security --limit "$ISSUE_LIMIT" --json number --jq 'length'); then SEC_ISSUES=$out; else err "security: security-labeled issue count failed"; fi

# ---------------------------------------------------- 6. claims + census --
CLAIMS_STALE='"unknown"'; CENSUS_CLAIMED='"unknown"'; CENSUS_PRS='"unknown"'; CENSUS_JOBS='"unknown"'; CENSUS_REGISTRY='"unknown"'; CENSUS_WORKTREES='"unknown"'
if out=$(g issue list --state open --limit "$ISSUE_LIMIT" --json number,labels,updatedAt --jq '[.[] | select([.labels[].name | startswith("claimed:")] | any)]'); then
  CENSUS_CLAIMED=$(printf '%s' "$out" | grep -o '"number":' | wc -l | tr -d ' ')
  CLAIMS_STALE=$(g issue list --state open --limit "$ISSUE_LIMIT" --json number,labels,updatedAt --jq "[.[] | select(([.labels[].name | startswith(\"claimed:\")] | any) and ((.updatedAt | fromdateiso8601) < (now - $STALE_SECONDS))) | .number]" || echo '"unknown"')
else
  err "claims: claimed:* issue scan failed"
fi
if [ -n "$AGENT_LOGIN" ]; then
  if out=$(g pr list --state open --json number,author --jq "[.[] | select(.author.login == \"$AGENT_LOGIN\")] | length"); then CENSUS_PRS=$out; else err "claims: open agent-PR count failed"; fi
else
  err "claims: --agent-login not provided; agent-PR census unknown"
fi
if out=$(g run list --status in_progress --json databaseId --jq 'length'); then CENSUS_JOBS=$out; else err "claims: running Actions jobs count failed"; fi
if [ -f "$PLAN_FILE" ] && grep -qi '^#.*fleet registry' "$PLAN_FILE"; then
  CENSUS_REGISTRY=$(awk 'tolower($0) ~ /^#+ .*fleet registry/{f=1;next} /^#/{f=0} f && /^- /' "$PLAN_FILE" | wc -l | tr -d ' ')
fi
if wt=$(git worktree list 2>/dev/null | wc -l | tr -d ' ') && [ "$wt" -ge 1 ]; then CENSUS_WORKTREES=$((wt - 1)); fi

# ----------------------------------------------------------- 7. merge pass --
# checks: "green" | "not-green" | "none". touches_protected_paths covers the
# file-based protected paths (docs/SENTINEL.md, AGENTS.md, .github/workflows/**,
# scripts/tick.sh — branch protection and scanner config are settings, not
# files). It is NOT the whole human-required set: the watchdog prose (step 6)
# also excludes production promotes and third-party / first-time-contributor
# PRs — judge those from the author field (and, where needed,
# gh api repos/{o}/{r}/pulls/<n> --jq .author_association) before merging.
MERGE_READY='"unknown"'
if out=$(g pr list --state open --limit 50 --json number,isDraft,statusCheckRollup,files,author --jq '[.[] | select(.isDraft | not) | {pr: .number, author: (.author.login // "unknown"), checks: (if ((.statusCheckRollup // []) | length) == 0 then "none" elif ([(.statusCheckRollup // [])[] | (.conclusion // .state // "")] | map(. == "SUCCESS" or . == "NEUTRAL" or . == "SKIPPED") | all) then "green" else "not-green" end), touches_protected_paths: ([(.files // [])[].path] | map(. == "docs/SENTINEL.md" or . == "AGENTS.md" or . == "scripts/tick.sh" or startswith(".github/workflows/")) | any)}]'); then
  MERGE_READY=$out
else
  err "merge_ready: open-PR check/file scan failed"
fi

# ----------------------------------------------------------------- 8. DoD --
DOD_BOARD_EMPTY='"unknown"'; DOD_SEC='"unknown"'; DOD_MAIN='"unknown"'; DOD_SENTINEL='"unknown"'; DOD_ACC='"unknown"'; DOD_DEPLOY='"unknown"'
if out=$(g issue list --state open --limit "$ISSUE_LIMIT" --json number --jq 'length'); then
  if [ "$out" = "0" ]; then DOD_BOARD_EMPTY='true'; else DOD_BOARD_EMPTY='false'; fi
fi
if [ "$SEC_DEP" != '"unknown"' ] && [ "$SEC_CODE" != '"unknown"' ] && [ "$SEC_SECRET" != '"unknown"' ]; then
  if [ "$SEC_DEP" = "0" ] && [ "$SEC_CODE" = "0" ] && [ "$SEC_SECRET" = "0" ]; then DOD_SEC='true'; else DOD_SEC='false'; fi
fi
DEFAULT_BRANCH=$(g repo view --json defaultBranchRef --jq .defaultBranchRef.name || echo "")
if [ -n "$DEFAULT_BRANCH" ]; then
  if out=$(g api "repos/$REPO/commits/$DEFAULT_BRANCH/check-runs" --jq '[.check_runs[].conclusion] | if length == 0 then "none" elif (map(. == "success" or . == "neutral" or . == "skipped") | all) then "true" else "false" end'); then
    case "$out" in \"none\"|none) DOD_MAIN='"unknown"'; err "dod: no check runs on $DEFAULT_BRANCH HEAD" ;; \"true\"|true) DOD_MAIN='true' ;; *) DOD_MAIN='false' ;; esac
  else
    err "dod: check-runs on $DEFAULT_BRANCH unreadable"
  fi
else
  err "dod: default branch unresolved"
fi
if out=$(g pr list --state merged --limit 10 --json number,statusCheckRollup --jq 'if length == 0 then "no-merges" elif ([.[] | [(.statusCheckRollup // [])[] | select((.name // .context // "") | test("sentinel"; "i")) | (.conclusion // .state // "")] | map(. == "SUCCESS") | any] | all) then "true" else "false" end'); then
  case "$out" in \"no-merges\"|no-merges) DOD_SENTINEL='"unknown"'; err "dod: no merged PRs yet to attest Sentinel gate" ;; \"true\"|true) DOD_SENTINEL='true' ;; *) DOD_SENTINEL='false' ;; esac
else
  err "dod: merged-PR Sentinel-check scan failed"
fi
if [ -x scripts/dod-check.sh ]; then
  hook=$(bash scripts/dod-check.sh 2>/dev/null || true)
  case "$hook" in *acceptance=true*) DOD_ACC='true' ;; *acceptance=false*) DOD_ACC='false' ;; *) err "dod: hook produced no acceptance= line" ;; esac
  case "$hook" in *deploy_verified=true*) DOD_DEPLOY='true' ;; *deploy_verified=false*) DOD_DEPLOY='false' ;; *) err "dod: hook produced no deploy_verified= line" ;; esac
else
  err "dod: scripts/dod-check.sh absent — acceptance/deploy_verified are agent judgment this tick"
fi
DOD_MET='false'
if [ "$DOD_BOARD_EMPTY" = 'true' ] && [ "$DOD_SEC" = 'true' ] && [ "$DOD_MAIN" = 'true' ] && [ "$DOD_SENTINEL" = 'true' ] && [ "$DOD_ACC" = 'true' ] && [ "$DOD_DEPLOY" = 'true' ]; then DOD_MET='true'; fi

# --------------------------------------------------------- 9. measurements --
M_MINUTES='"unknown"'; M_READY='"unknown"'; M_DAYS='"unknown"'
TODAY=$(date -u +%Y-%m-%d)
if out=$(g api -X GET "repos/$REPO/actions/runs" -f "created=>=$TODAY" -f per_page=100 --jq '[.workflow_runs[] | select(.run_started_at != null) | ((.updated_at | fromdateiso8601) - (.run_started_at | fromdateiso8601))] | (add // 0) / 60 | floor'); then M_MINUTES=$out; else err "measurements: Actions runs unreadable"; fi
if out=$(g issue list --state open --label ready --limit "$ISSUE_LIMIT" --json number --jq 'length'); then M_READY=$out; else err "measurements: ready count failed"; fi
if [ -n "$COFOUNDER_LOGIN" ]; then
  if out=$(g api "repos/$REPO/issues/events?per_page=100" --jq "[.[] | select(.actor.login == \"$COFOUNDER_LOGIN\")] | first | .created_at // empty"); then
    if [ -n "$out" ]; then
      M_DAYS=$(g api "repos/$REPO/issues/events?per_page=100" --jq "([.[] | select(.actor.login == \"$COFOUNDER_LOGIN\")] | first | .created_at | fromdateiso8601) as \$t | ((now - \$t) / 86400) | floor" || echo '"unknown"')
    else
      err "measurements: no cofounder-attributed issue event in the last 100 — verify per step 9"
    fi
  else
    err "measurements: issue events unreadable"
  fi
else
  err "measurements: --cofounder-login not provided"
fi

# ---------------------------------------------------------------- report --
ERRJSON="[]"
for e in ${ERRORS+"${ERRORS[@]}"}; do
  esc=$(printf '%s' "$e" | sed 's/\\/\\\\/g; s/"/\\"/g')
  if [ "$ERRJSON" = "[]" ]; then ERRJSON="[\"$esc\"]"; else ERRJSON="${ERRJSON%]}",\"$esc\""]"; fi
done

cat <<REPORT
{
  "tick_report": "v1",
  "template_version": "$TEMPLATE_VERSION",
  "repo": "$REPO",
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "halt": {"state": $HALT_STATE, "issues": $HALT_ISSUES},
  "board": {"exists": $BOARD_EXISTS, "linked_to_repo": $BOARD_LINKED, "control_issue_pinned": $CONTROL_PINNED, "status_options_ok": $STATUS_OPTIONS_OK},
  "gate_parity": {"ok": $GP_OK, "handoff_only": $GP_HANDOFF_ONLY, "board_only": $GP_BOARD_ONLY, "body_hash_mismatch": $GP_HASH_MISMATCH},
  "status_drift": $STATUS_DRIFT,
  "reconcile": {"untriaged": $UNTRIAGED, "close_sweep": $CLOSE_SWEEP},
  "security": {"dependabot_high_critical": $SEC_DEP, "code_scanning_high_critical": $SEC_CODE, "secret_scanning_open": $SEC_SECRET, "security_issues_open": $SEC_ISSUES},
  "claims": {"stale": $CLAIMS_STALE, "census": {"claimed_labels": $CENSUS_CLAIMED, "open_agent_prs": $CENSUS_PRS, "running_jobs": $CENSUS_JOBS, "registry_entries": $CENSUS_REGISTRY, "local_worktrees": $CENSUS_WORKTREES}},
  "merge_ready": $MERGE_READY,
  "dod": {"board_empty": $DOD_BOARD_EMPTY, "security_clean": $DOD_SEC, "main_green": $DOD_MAIN, "sentinel_on_merges": $DOD_SENTINEL, "acceptance": $DOD_ACC, "deploy_verified": $DOD_DEPLOY, "dod_met": $DOD_MET},
  "measurements": {"actions_minutes_today": $M_MINUTES, "ready_count": $M_READY, "days_since_cofounder_activity": $M_DAYS},
  "errors": $ERRJSON
}
REPORT
