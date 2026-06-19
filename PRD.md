# PRD — github-dashboard (v1)

> Product Requirements Document for the v1 MVP. Synthesizes the four Phase‑1
> research reports (`research-ux`, `research-api`, `research-auth`,
> `research-portart`) into a decision‑useful spec. Binding brief: [`MISSION.md`](./MISSION.md).
> Sequencing lives in [`ROADMAP.md`](./ROADMAP.md).

**Status:** Phase 1 (approved research → spec). **Last updated:** 2026-06-19.

---

## 1. Problem & target users

**Target user.** A maintainer who owns or co‑maintains *many* GitHub repositories
(typically 10–50, across one or more orgs) and has no single place to see, across
all of them, what is broken, what is waiting on them, and what is risky.

**Problem.** GitHub surfaces health *per repo*. To answer "which of my repos have
failing CI, open security alerts, or a first‑time‑contributor PR waiting on me?"
the maintainer must click through every repo, or stitch together the activity
feed, the notifications inbox, and (for orgs only) Security Overview. None of
these is a cross‑repo *fleet health* view.

**Gap (confirmed by `research-ux` competitive scan).** Octobox solves
notifications, Mergify/Trunk solve merge‑queue/CI automation, GitHub Security
Overview is org‑scoped and security‑only. **No existing tool provides a personal,
client‑only, multi‑repo fleet‑health grid** covering CI + security + review queue
+ outside‑contributor PRs + staleness in one view, with no server and no
subscription. That gap is exactly what github‑dashboard fills.

**Success vision (`MISSION.md` §1).** Fast, private, zero‑install, no backend —
good enough that millions of maintainers use it.

---

## 2. Goals & non‑goals

### Goals (v1)
- A single, scannable, cross‑repo **fleet‑health grid** spanning the 7 MVP signals (§4).
- **Fully client‑only**: token + data never leave the browser except calls to GitHub‑owned origins (`MISSION.md` §5).
- **Zero‑install**: a public GitHub Pages URL plus a one‑click "use it now" link.
- **Rate‑limit safe** at fleet scale (≥50 repos) without a backend (§8).
- **Accessible** to WCAG 2.1 AA (§6).

### Non‑goals (explicitly out of scope for v1 — `MISSION.md` §4)
- **Release / version tracking** (post‑MVP backlog).
- **Notifications inbox** (Octobox already owns this; not our paradigm).
- **Discussions monitor** (post‑MVP backlog).
- **Any write actions** (merge/close/comment/dismiss). v1 is **read‑only**.
- **Any backend / proxy / OAuth device flow** in v1 — deferred, gated decision (§7, issue #3).
- **Secret‑scanning alerts**, repo topic/language filtering, keyboard `j/k` shortcuts — noted as post‑MVP (`research-api`, `research-ux` §Gaps).

---

## 3. Reuse posture (`research-portart`)

The data layer is **~80% portable** from `pedrofuentes/stream-deck-github-utilities`
(SHA `8e27e96…`, MIT). Browser‑safe, `zod`‑only modules port with **~8 total lines
of adaptation** (`streamDeck.logger` → `console`, drop `@elgato/utils` `JsonValue`
import, rename `User-Agent`). The Stream Deck rendering/action layer is discarded;
React rendering is built fresh. **One net‑new capability** must be added on top of
the port: **ETag / `If-None-Match` conditional‑request caching** (the source has
none — `research-portart` §7.1).

---

## 4. MVP features & acceptance criteria

All seven render as columns in one repo‑per‑row grid (§5). Acceptance criteria are
testable; "the grid" = the fleet‑overview grid. Each feature degrades per‑cell on
partial error (§5, REC‑7) rather than failing the row.

### F1 · Fleet overview grid
All selected repos at a glance, one row per repo, one column per health signal.
- **AC1.** Given N configured repos, the grid renders exactly N rows, each anchored by `owner/repo` (truncated ~24 chars, full name in tooltip).
- **AC2.** Columns appear left→right: Repo · CI · Security · Review queue · New external PRs · Issues · Stale (`research-ux` REC‑1).
- **AC3.** Default sort is "most broken" via the composite score `critical×100 + high×20 + failing_ci×50 + review_queue×10 + stale×5` (`research-ux` REC‑6).
- **AC4.** Clicking any column header sorts by that signal and toggles asc/desc; sort state exposes `aria-sort` on the `<th>`.
- **AC5.** A repo‑name substring filter narrows visible rows **client‑side with zero API calls**; filter + sort persist in `localStorage`.
- **AC6.** Rows render as skeletons immediately and "snap" to live data per repo as each repo's data arrives (no full‑page spinner).

### F2 · Actions / CI status
Surface failing and in‑progress workflow runs prominently.
- **AC1.** The CI cell shows a single state — pass / fail / in‑progress / queued — via icon **and** text/`aria-label`, never color alone (`research-ux` REC‑3).
- **AC2.** State derives from the latest run(s) per repo using `GET /repos/{owner}/{repo}/actions/runs` (`status`/`conclusion`) (`research-api` §1a).
- **AC3.** Repos with a failing run sort above passing repos under the default "most broken" sort.
- **AC4.** The drill‑down CI tab lists recent runs with name, status, duration, and a direct link to the run URL.

### F3 · Open PRs (new outside‑contributor PRs highlighted)
Show open PR counts and prominently flag PRs from first‑time / external contributors.
- **AC1.** An "external PR" = a PR whose `author_association` ∈ {`FIRST_TIME_CONTRIBUTOR`, `FIRST_TIMER`, `NONE`} (`research-api` §1b).
- **AC2.** The New‑External‑PRs cell renders an orange badge (e.g. `⬆ 3 external`) when >0, and a neutral `—` when 0, with a descriptive tooltip / `aria-label`.
- **AC3.** Total open‑PR count is visible (cell or drill‑down) and external PRs are visually distinguished from internal ones.
- **AC4.** The drill‑down PRs tab lists open PRs with author, title, age, author‑association badge, and review status.

### F4 · Security alerts (Dependabot + code‑scanning, graded)
Aggregate open security alerts with a severity grade.
- **AC1.** The Security cell shows a grouped severity badge (e.g. `C:2 H:1`) or a clear all‑clear state when zero (`research-ux` REC‑1).
- **AC2.** Data merges **Dependabot** (`security_advisory.severity`) and **code‑scanning** (`rule.security_severity_level`) on the `critical/high/medium/low` scale; the drill‑down indicates each alert's source (`research-api` §1c, §4).
- **AC3.** A per‑repo letter grade is computed by worst‑case escalation — A (none) → B (low only) → C (≥1 medium) → D (≥1 high) → F (≥1 critical) (`research-api` §4; ported `computeGrade`, `research-portart` §3.3).
- **AC4.** Where the token's org grants it, alerts are fetched via the **org‑level** endpoints (1 request each) instead of per‑repo (`research-api` §1c).
- **AC5.** Severity encoding is colorblind‑safe (Okabe‑Ito‑aligned) and never color‑only.

### F5 · Review‑requested queue
PRs awaiting *the authenticated user's* review, with urgency.
- **AC1.** The Review cell shows the count of PRs where the token's user is review‑requested; a red badge when >0 (`research-ux` REC‑1).
- **AC2.** Source is the Search API `is:open is:pr review-requested:@me` (single cross‑repo request) **or** filtering already‑cached PR `requested_reviewers` — no per‑repo extra call (`research-api` §1d).
- **AC3.** Search usage stays within the **separate 30 req/min** search bucket (≤ a few search calls/min).
- **AC4.** The drill‑down lists each review‑requested PR with repo, title, and age.

### F6 · Issues overview
Open / triage counts and recent activity per repo.
- **AC1.** The Issues cell shows an open‑issue count, with an amber treatment past a configurable threshold (`research-ux` REC‑1).
- **AC2.** Counts exclude PRs (use issue‑only Search `is:issue is:open` or subtract, since repo `open_issues_count` includes PRs) (`research-api` §1e).
- **AC3.** Recent‑activity ordering uses `updated_at` (sort `updated`, `since`) (`research-api` §1e).

### F7 · Stale detection
PRs/issues with no activity past a threshold.
- **AC1.** "Stale" = `updated_at` older than a configurable threshold (defaults: 30d PRs, 60d issues) (`research-ux` REC‑4).
- **AC2.** The Stale cell shows a clock icon + count when >0 and a gray `—` when 0 (noise reduction).
- **AC3.** Staleness is computed **client‑side from already‑fetched `updated_at`** (or the `updated:<DATE` search filter) — **zero extra per‑repo polling** (`research-api` §1f).
- **AC4.** Drill‑down lists stale items with relative age (e.g. "PR #42 · 47d").

---

## 5. UX direction (summary of `research-ux`)

- **Layout — repo‑per‑row grid, not cards** (REC‑1). Maintainer's primary task is *comparison* across repos for one signal (a column scan), which cards defeat.
- **Density — compact ~44–48px rows** (REC‑2): full fleet visible with minimal scroll; 44px also meets WCAG 2.5.5 target size. Icon+number cells, no inline text labels; full‑row hover highlight.
- **Severity & color — colorblind‑safe, never color‑only** (REC‑3): Okabe‑Ito‑aligned palette mapped to GitHub Primer tokens; every colored icon also carries a DOM text label.
- **Outside‑contributor PRs surfaced prominently** (REC‑5): community‑health signal — first‑timers abandon PRs if unanswered.
- **Sorting & filtering** (REC‑6): default "most broken" composite sort; click‑to‑sort headers; client‑side repo‑name filter; persist in `localStorage`.
- **Loading / empty / error states** (REC‑7): per‑repo skeletons; **per‑cell** `⚠` on partial failure (don't fail the whole row); friendly empty state; dismissible rate‑limit banner when remaining is low; full‑page prompt on missing/invalid token.
- **Progressive disclosure — right‑side drawer drill‑down** (REC‑8): preserves grid scan position; tabs for CI / Security / PRs / Issues / Stale; Esc/X returns focus to the triggering row.
- **Refresh / polling UX** (REC‑9): per‑repo / global "refreshed N min ago"; staggered auto‑refresh (default 5 min; 60s for repos with in‑progress runs); manual "Refresh all"; respect `prefers-reduced-motion`.
- **Settings & repo management** (REC‑10): paste `owner/repo` list (or bulk‑import owned/member repos); masked PAT input with reveal; column‑visibility toggles; configurable stale thresholds.

---

## 6. Accessibility (WCAG 2.1 AA — summary of `research-ux` Part 3)

v1 targets **WCAG 2.1 AA**. The full normative checklist (A‑01…D‑07, each citing
its Success Criterion) lives in `research-ux`. Required for v1:

- **Perceivable.** Color + non‑color indicator for every status (SC 1.4.1); text contrast ≥ 4.5:1 (1.4.3) and non‑text ≥ 3:1 (1.4.11); resize to 200% (1.4.4) and reflow at 320px to a stacked card view (1.4.10); `sr-only` text for every icon‑only cell (1.3.1); `aria-live="polite"` for refresh, `role="alert"` only for critical errors (token/rate‑limit/network); honor `prefers-reduced-motion` (2.3.3); light **and** dark themes both pass AA (Primer guidance).
- **Operable.** Fully keyboard‑operable (2.1.1); skip link (2.4.1); grid implements the **ARIA Data Grid** pattern — single tab stop, arrow/Home/End navigation, one `tabindex="0"` cell (APG); visible ≥3:1 focus ring (2.4.7); disclosure pattern for row expand (`aria-expanded`/`aria-controls`); drawer focus management + return (2.4.3); sortable headers expose `aria-sort` (4.1.2); no keyboard trap (2.1.2).
- **Understandable.** `<html lang="en">` (3.1.1); consistent top‑nav placement (3.2.3); specific error messages (3.3.1).
- **Robust.** ARIA grid roles for the interactive grid, native `<table>` for static drawer tables (APG); accessible names on icon buttons (4.1.2); ≤7 landmark regions (APG); a hidden `role="status"` fleet summary ("Monitoring 12 repos. 2 failing CI…"); test in forced‑colors mode.

Accessibility is verified in the dedicated a11y pass (`ROADMAP.md` M9) and is a **Definition‑of‑Done** quality bar.

---

## 7. Auth & privacy (`research-auth`; design under sign‑off in issue #3)

**Decision context.** Auth/token‑storage/privacy is a **HUMAN‑REQUIRED** gate
(`MISSION.md` §9). The design below is the approved‑research proposal pending
cofounder sign‑off in **DECISION issue #3** — *no auth/token‑persistence code ships
before that sign‑off.*

- **v1 auth = fine‑grained, read‑only PAT**, pasted once. **Device flow, Auth‑Code+PKCE, and Implicit are ALL CORS‑blocked** from a pure SPA — GitHub's `github.com/login/*` token endpoints return no `Access-Control-Allow-Origin`; only a backend/proxy can complete them (`research-auth` §1, §3). `api.github.com` *does* send CORS, so the PAT path is fully self‑contained.
- **PAT permissions (7, all read‑only):** Actions · Code scanning alerts · Contents · Dependabot alerts · Issues · Metadata · Pull requests (`research-api` §3).
- **Token storage model** (`research-auth` §2.5): **in‑memory by default**; opt‑in "remember this session" → `sessionStorage`; opt‑in "remember across sessions" → `localStorage`; an always‑visible **"Forget token"** clears all three. **No Web‑Crypto "encryption theater"** — with no backend secret, encryption adds no real XSS protection for a read‑only token; the "no third‑party scripts" + strict CSP rule is the real mitigation.
- **Device flow DEFERRED for v1**, with written rationale + cofounder sign‑off (`MISSION.md` §8). Exit condition: GitHub adds CORS (unlikely) **or** a stateless proxy is approved (a separate gated decision). The PKCE *authorize* (redirect) step may be pre‑built speculatively without shipping the broken token exchange.
- **Privacy invariant.** Token + all data live **only** in the browser; no telemetry, no third parties (`MISSION.md` §5).
- **Network allowlist (runtime origins) — GitHub‑owned only:** `api.github.com`, `github.com/login/*` (future auth), `avatars.githubusercontent.com` / `raw.githubusercontent.com` (images). Fonts/assets bundled locally; **no CDN/analytics origins**. Enforced by a strict CSP and **verified by an automated Playwright network‑interception test** (a Definition‑of‑Done item; `ROADMAP.md` M7).

---

## 8. Rate‑limit strategy (`research-api` §2)

Budget: **5,000 REST req/hr** and a **separate** 5,000 GraphQL points/hr (PAT).
Target scale: 50 repos @ 5‑min polling. Measured budget ≈ **1,200 req/hr without
ETags**, **<300/hr with ETags** — far under the ceiling.

- **ETag / `If-None-Match` conditional requests** — a `304` costs **0** against the primary limit. Net‑new vs. the port; cache `{url → {etag, data}}`. ~80% of idle‑fleet polls become free.
- **Org‑level Dependabot + code‑scanning endpoints** collapse 50 per‑repo calls into **1 each**.
- **Compute from cached data** where possible: issue counts, stale detection, and outside‑contributor detection reuse already‑fetched payloads (0 extra calls).
- **`GET /rate_limit` pre‑check** before each batch (free, uncounted); surface a dismissible banner when `x-ratelimit-remaining` is low — never silently stop refreshing.
- **Stop polling when the tab is hidden** (Page Visibility API); **stagger** requests to stay under secondary limits (≤100 concurrent, ≤900 REST pts/min); honor `Retry-After` with exponential backoff; on persistent limiting, show **degraded mode** with last‑known cached data.
- **Batched GraphQL** (alias ~10 repos/query) for cross‑repo PR refresh when REST batching is insufficient.

---

## 9. Success metrics

- **Activation:** a new user pastes a PAT and sees a populated fleet grid in **< 60s**, with **no horizontal scrolling** for ≤8 columns on a 1080p viewport.
- **Coverage:** all **7** MVP signals render for a 50‑repo fleet.
- **Rate‑limit headroom:** steady‑state polling of 50 repos stays **< 25%** of the hourly REST budget (target <1,300/hr; <300/hr with ETags).
- **Privacy:** the automated network test passes — **0** requests to non‑GitHub origins.
- **Accessibility:** automated a11y checks pass with **0** critical violations; keyboard‑only operation of grid + drawer verified.
- **Quality gate:** test coverage **≥ 80%** (Sentinel ratchet, never decreases — `MISSION.md` §7).
- **Distribution:** a live GitHub Pages URL loads with **no console errors**; README has screenshots/GIF + a one‑click "use it now" link.

---

## 10. Key risks

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| R1 | **Device flow stays infeasible** (CORS) → no zero‑PAT onboarding | High (structural) | Ship PAT‑only v1; defer device flow with sign‑off; pre‑build PKCE authorize step only (`research-auth`). |
| R2 | **Outside‑contributor + stale signals need PR/issue *node* fetches**, not just counts → higher API cost | Medium | Use GraphQL aliasing for `authorAssociation`; compute staleness from cached `updated_at`; org‑level alert endpoints (`research-api`, `research-ux` §Gaps 1–2). |
| R3 | **ETag layer is net‑new** (absent from the port) → if mis‑implemented, budget blows up | Medium | Treat ETag caching as a first‑class, separately‑tested integration task (`ROADMAP.md` M3); `/rate_limit` pre‑checks as backstop. |
| R4 | **Search API stricter 30/min bucket** for review‑requested + stale queries | Low | Keep search to a few calls/min; prefer cached‑PR filtering where possible (`research-api` §2). |
| R5 | **XSS would expose a persisted token** | Low | "No third‑party scripts" + strict CSP + `textContent` (not `innerHTML`); in‑memory default; read‑only token limits blast radius (`research-auth` §2.3). |
| R6 | **Org‑level alert endpoints unavailable** for personal repos / insufficient grant | Medium | Per‑repo fallback already specified; degrade the Security cell per‑repo (`research-api` §1c). |
| R7 | **Code‑scanning vs Dependabot severity vocabularies differ** | Low | Normalize both to `critical/high/medium/low`; show source in drawer (`research-api` §1c, §4). |
| R8 | **No webhooks in a client‑only SPA** → polling is the only option | Accepted | Polling + ETag + visibility‑aware scheduling is the sanctioned approach (`research-api` §Gaps 6). |
