# Orchestration — Running the Sub-Agent Fleet

How the autonomous build is organized as a small "company" of sub-agents operating under the `agents-template` + Sentinel rules. The **Delivery Lead** (the top-level agent that received the kickoff prompt) owns the board, spawns the fleet, invokes Sentinel, and merges. Everyone else is a sub-agent. *(The cofounder handle for @-mentions is in `MISSION.md` §1.)*

## The org

| Role | Who | Responsibility | Harness mapping |
|------|-----|----------------|-----------------|
| **Delivery Lead** (you) | top-level orchestrator | Owns the GitHub Project board; spawns/coordinates sub-agents; invokes Sentinel; runs the Pre-Merge Checklist; merges; arms the watchdog | Never reviews own code; invokes Sentinel from *outside* every implementation chain |
| **Research guild** | `research` / `explore` sub-agents | User/domain research, competitive & prior-art scan, best practices — with citations | Delegated research (>5 sources); output feeds the PRD |
| **Product (PM)** | `general-purpose` sub-agent | Turns research into `PRD.md`, prioritizes, creates board issues with acceptance criteria | Decomposes into 1-PR-sized increments |
| **Architecture** | `general-purpose` sub-agent | ADRs in `DECISIONS.md`, core/integration layer design, auth/security design, data model, deploy/distribution | Architecture decisions are ASK-FIRST unless pre-authorized by `MISSION.md` §9 |
| **Engineering guild** | `general-purpose` sub-agents (1 per increment) | Implement one issue each, TDD, in an isolated worktree; open a PR; **stop & report** | **Delegated implementer** — never self-reviews, never merges |
| **Test / QA** | `general-purpose` / `task` sub-agents | Test data, e2e, accessibility + performance/security audits | Tests are first-class; coverage ratchets up |
| **Sentinel** | full-capability sub-agent w/ `docs/SENTINEL.md` as system prompt | Independent merge gate; APPROVED / CONDITIONAL / REJECTED | **Coder ≠ reviewer, always.** Must be able to spawn its own dimension sub-agents |
| **DevOps** | `general-purpose` sub-agent | CI workflows, Sentinel-in-CI (Method B), deploy/distribution, branch protection | CI/CD changes are pre-authorized per `MISSION.md` §9 |

## Non-negotiable harness rules the fleet must honor

- **Sub-agents do NOT inherit `AGENTS.md`.** When spawning any sub-agent, **copy into its prompt**: the TDD choreography (`test(red)` → `feat(green)` → `refactor`), the 4-tier Boundaries, and the **Delegated Implementation rule** (code → test → pre-push verify → push → open PR → **stop**; report PR URL + HEAD SHA upward; do not invoke Sentinel on your own work, do not merge).
- **Sentinel is invoked by an agent OUTSIDE the entire implementation chain.** For nested delegation (Lead → engineer → helper), each implementer stops and reports upward; only the Lead (or a sibling not in the chain) invokes Sentinel.
- **Sentinel must be a full-capability model** (≥ Sonnet-class) able to run commands and spawn the A–F dimension sub-agents. Never a fast/cheap/explore-class model.
- **One worktree per increment.** `git worktree add .worktrees/<name> -b <type>/<name> main`. Never commit on `main`.

## Parallelization model

- Independent features → **parallel worktrees + parallel engineer sub-agents**. Keep each increment to one logical unit (one PR).
- **Serialize merges through Sentinel.** After each merge to `main`, **rebase the other in-flight worktrees** on the new `main` (`git fetch origin main && git rebase origin/main`) and re-run their suites before their own Sentinel review.
- Choose parallel tracks that don't touch the same files (e.g., "core layer", "primary UI/surface", "auth/security", "CI/deploy") to minimize rebase conflicts.

## Per-increment merge protocol

1. Engineer: failing test → minimal impl → refactor green → **Pre-Push Verification** (test-first ordering, full suite green, lint clean) → push → open PR → **stop & report** PR URL + HEAD SHA.
2. Lead: print "Invoking Sentinel…", spawn a full-capability Sentinel sub-agent with `docs/SENTINEL.md` as system prompt; pass the PR diff (`git diff main...HEAD`) wrapped in `<untrusted_pr_input>`, branch, PR URL, changed files, and any open `sentinel:*` issues.
3. Lead: complete the **Pre-Merge Checklist** (Report ID, verdict, reviewed SHA == HEAD, Mode, non-author confirmation). Empty box → do not merge.
4. On **APPROVED/CONDITIONAL** → merge; persist the Sentinel report; file new 🟡/🟢 findings as `sentinel:important` / `sentinel:minor` issues; clean up the worktree. (CONDITIONAL is a valid merge under the harness — its conditions are filed as `sentinel:*` issues and must be resolved before the final Definition-of-Done sign-off.) On **REJECTED** → engineer fixes 🔴 blockers, re-commit, re-invoke (max 5 cycles → escalate to the cofounder).

## Coordination & memory

- **GitHub Project board + issues = the source of truth and the work queue.** Keep it current; it's how the cofounder watches progress.
- `LEARNINGS.md` — log every Sentinel rejection pattern + correction; re-read before each PR to self-check.
- `DECISIONS.md` — ADRs. `CHANGELOG.md` — user-facing changes.

## Handling gates without stalling the fleet

When an increment hits an **ASK-FIRST** (not pre-authorized in `MISSION.md` §9) or **HUMAN-REQUIRED** action: open a clearly-described, labeled issue, @-mention the cofounder, move that card to a **Blocked** column — **and immediately pick up the next unblocked board item.** The fleet never goes fully idle because of a single gate. The watchdog (`CONTINUOUS-OPERATION.md`) periodically re-checks whether blocked items have been unblocked.
