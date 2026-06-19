# Continuous Operation — Keeping the Agent Always Working

> This is the direct answer to *"how do I ensure the agent is always working — a cron or something else?"*
> The short version: **the board is the heartbeat**, a **watchdog schedule** keeps a live session moving, and a **scheduled GitHub Actions + Copilot cloud agent** loop keeps things moving even when your laptop is off. A clear **Definition of Done** and **kill switch** stop it on purpose.

## Principle: the board is the heartbeat

Remaining work = open issues in the **GitHub Project board**. "Keep going" means "while a *ready* issue exists, take the next one." This is more robust than a blind timer because it's **stateful** — progress is measured by cards moving to Done, not by a clock. "Done" = board empty **and** every Definition-of-Done item verified.

A card is **ready** when it's not Blocked and its dependencies are merged. A card is **Blocked** only when waiting on a HUMAN-REQUIRED/ASK-FIRST gate (see below). The PM phase seeds the board with a card for **every** Definition-of-Done item (features *and* deploy/privacy/docs/a11y/perf/release verification), so the board cannot go empty while non-feature DoD work remains.

### Avoiding double-work — atomic issue claim

Both the Tier-1 watchdog and the Tier-2 cron can see the same *ready* card, and GitHub issue reads are not atomic. Any dispatcher MUST claim before working:
1. **Claim:** add the assignee + a `claimed:<agent-id>` label and move the card to **In-Progress** (one `gh` call).
2. **Verify:** immediately re-fetch the issue; proceed only if it still shows *your* claim and no competing assignee/claim. If another agent already claimed it, skip to the next ready card.
3. **Stale-claim timeout:** a `claimed:` card with no commit/PR activity for ~60 min may be reclaimed (clear the old claim first).
4. **Serialize dispatch:** the Tier-2 workflow uses a `concurrency:` group so only one tick dispatches at a time.

---

## Tier 1 — In-session watchdog (while your Copilot CLI session is open)

Use the `manage_schedule` tool to create a recurring "heartbeat" that nudges the agent so it never silently idles. This is the practical "cron" for a local run.

**Arm it** (interval example — every 20 minutes):

```
manage_schedule action=create interval=20m prompt=<the watchdog prompt below>
```

(Or a calendar cron, e.g. `cron="*/20 9-23 * * *"` for every 20 min between 09:00–23:00.)

**Watchdog prompt to schedule:**

> Watchdog tick. Read the github-dashboard GitHub Project board. If the Definition of Done is not yet fully met: confirm an increment is actively in progress; if the fleet is idle or a task has stalled, resume the next *ready* issue (spawn an engineer sub-agent in a fresh worktree). Re-check every **Blocked** card to see whether @pedrofuentes has unblocked it; if so, move it back to Ready and proceed. If you are fully blocked with no ready work, post a concise status comment summarizing what you need. If the Definition of Done **is** fully met and verified (live Pages URL loads, MVP features work, suite green, every merge Sentinel APPROVED/CONDITIONAL with conditions resolved, docs shipped), stop this schedule with `manage_schedule action=stop` and report the live URL.

**Limitation:** scheduled prompts only fire while the Copilot CLI host/session is alive. Close the laptop and Tier 1 pauses — that's what Tier 2 is for.

---

## Tier 2 — Durable 24/7 (laptop off, fully unattended)

Move the loop into GitHub's infrastructure so it runs without your machine:

1. **Scheduled GitHub Actions workflow** (`on: schedule:`) that, on each tick, finds the next open `ready` issue and **assigns it to the Copilot coding agent** (cloud) — which works autonomously and opens a PR. Sketch:

   ```yaml
   # .github/workflows/agent-tick.yml
   on:
     schedule:
       - cron: "*/30 * * * *"   # every 30 min
     workflow_dispatch: {}        # manual kick / kill via the UI toggle
   concurrency:
     group: agent-dispatch        # only one dispatcher tick at a time
     cancel-in-progress: false
   jobs:
     dispatch-next:
       runs-on: ubuntu-latest
       steps:
         - name: Claim next ready issue, then hand it to the coding agent
           run: |
             # 1) gh issue list --label ready --search 'no:assignee' --state open
             # 2) claim: gh issue edit <n> --add-assignee @copilot --add-label 'claimed:cloud'
             # 3) re-fetch to confirm the claim is ours; if not, pick the next
             # 4) hand the claimed issue to the Copilot coding agent
   ```

   (The exact "assign to coding agent" step depends on the repo's Copilot coding-agent setup; the DevOps sub-agent wires this during the build.)

2. **Sentinel-in-CI (Method B)** as a **required status check** + **branch protection on `main`** → quality is enforced unattended; nothing merges without an APPROVED/CONDITIONAL Sentinel verdict.

3. **Optional** `copilot-setup-steps.yml` to preinstall the toolchain so cloud-agent runs start fast.

**Prerequisites (cofounder, one-time):** enable the **Copilot coding agent** on the repo; allow **GitHub Actions** and **Pages**. Until then, Tier 2 is dormant and Tier 1 carries the work.

---

## Tier 3 — Human-in-the-loop gates (you are the unblock path)

Some actions are deliberately gated (`AGENTS.md` HUMAN-REQUIRED / ASK-FIRST): auth/crypto sign-off, adding a backend/proxy (e.g. if device-flow needs one), production-deploy enablement, 5× Sentinel rejections. The fleet **does not stall** on these — it files a labeled issue, @-mentions you, moves the card to **Blocked**, and continues other work. Your job as cofounder is to **respond fast**; the watchdog resumes the card as soon as you unblock it. This is the intended "second human" loop from the kickoff.

---

## Definition of Done (the stop target)

Live Pages URL loads · MVP features work on real data · PAT auth works (device-flow done or signed-off deferred) · privacy invariant verified by the automated network test (GitHub-owned origins only) · suite green + coverage ≥ threshold + lint/typecheck clean · every merge carried a Sentinel APPROVED/CONDITIONAL verdict with all conditions resolved · README/LICENSE/CONTRIBUTING shipped · board empty.

## Stop conditions

- **Done:** Definition of Done fully met → watchdog self-stops.
- **Escalation:** 5× Sentinel rejection on one issue, or the same failure 3× → stop that track, escalate to the cofounder (do not retry the same approach).
- **Blocked everywhere:** no ready work and all remaining cards need you → post status, keep the watchdog armed, wait.

## Kill switch (how to pause/stop on demand)

- **Stop the watchdog:** `manage_schedule action=list` → `manage_schedule action=stop id=<id>`.
- **Stop the durable loop:** disable the `agent-tick.yml` workflow (Actions tab → Disable workflow) or remove the `schedule:` trigger.
- **Freeze the queue:** move cards to a **Paused** column / close the board; the agent treats an empty ready-set as "nothing to do."
- **Resume:** re-arm the watchdog and/or re-enable the workflow; move cards back to Ready.

## Recommended setup

- **During active sessions:** run the **Tier 1 watchdog** (every ~20 min).
- **For overnight / away:** stand up **Tier 2** (scheduled Actions + Copilot cloud agent + Sentinel-in-CI + branch protection).
- Keep both: Tier 1 gives fast local iteration; Tier 2 guarantees forward progress when you're offline. The board reconciles them via the **atomic issue-claim protocol** above (claim-then-verify + a `concurrency:` group), so each card is only ever worked by one agent at a time.
