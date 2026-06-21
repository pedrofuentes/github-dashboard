# ROADMAP — github-dashboard

> Prioritized, dependency-ordered milestones for the v1 MVP. Derived from
> [`PRD.md`](./PRD.md), [`MISSION.md`](./MISSION.md), and the four Phase‑1
> research reports (`research-ux`, `research-api`, `research-auth`,
> `research-portart`). Each milestone maps to seed issues (see the PM issue
> breakdown). **✅ DoD** marks a `MISSION.md` §8 Definition‑of‑Done requirement.

**Current phase:** Phase 1 complete (research → PRD/ROADMAP). Next: **M1 scaffold + CI**.

## Definition of Done (MISSION §8) — the v1 gate
- ✅ **Live GitHub Pages URL** serves the SPA and loads with no console errors.
- ✅ **Fine‑grained PAT** path works end‑to‑end against real GitHub data; **device flow** implemented *or* explicitly deferred with rationale + cofounder sign‑off.
- ✅ **Privacy invariant** verified by the automated Playwright network test (GitHub‑owned origins only).
- ✅ **Rate‑limit safe**: conditional (ETag) requests + batched GraphQL; degrades gracefully near 5,000 req/hr.
- ✅ **README** with screenshots/GIF + a one‑click "use it now" link.
- (Quality ratchet, all milestones) coverage ≥ 80%, lint‑clean, zero 🔴 Sentinel findings — never decreases.

---

## Milestones (dependency‑ordered)

### M1 · Scaffold + CI + branch protection
*Foundation everything else builds on.*
- **Issues:** `Scaffold Vite + React + TypeScript + Tailwind app`; `CI: lint, typecheck, test + coverage gate, Sentinel Method B, branch protection`.
- **Exit:** app boots locally; `npm run build|lint|typecheck|test` green; CI runs on PRs; branch protection requires the quality checks on `main`.
- **Notes:** stack + CI authoring are pre‑authorized (`MISSION.md` §9). Coverage gate starts at 80 and ratchets.

### M2 · Integration layer (port) + ETag / rate‑limit  — ✅ DoD (rate‑limit safe)
*~80% portable from `stream-deck-github-utilities`; ETag caching is net‑new.*
- **Issues:** `Port GitHub API integration layer (REST + GraphQL + Zod + polling)`; `Add ETag conditional-request caching + rate-limit budget guard`.
- **Depends on:** M1.
- **Exit:** REST + GraphQL client validated by Zod; `fetchWithRetry` + backoff; polling/caching coordinators; **ETag `If-None-Match`** → `304` = 0‑cost; `GET /rate_limit` pre‑check + visibility‑aware polling; degrades gracefully near the limit.
- **Research:** `research-portart` §5 (port list), `research-api` §2 (budget).

### M3 · Auth (PAT) + token storage  — ✅ DoD (PAT path)  🚨 HUMAN‑REQUIRED
*No auth/token‑persistence code ships before sign‑off on DECISION issue #3.*
- **Issues:** `PAT auth + in-browser token storage`.
- **Depends on:** M1 + **DECISION issue #3** (auth/token‑storage design sign‑off).
- **Exit:** fine‑grained read‑only PAT (7 scopes) pasted once; **in‑memory default**, opt‑in `sessionStorage`/`localStorage`, always‑visible **"Forget token"**; live calls succeed against `api.github.com`. Device flow **deferred** with written rationale (`MISSION.md` §8, `research-auth`).

### M4 · The 7 MVP features + drill‑down  — MVP
*One repo‑per‑row grid; columns degrade per‑cell on partial error.*
- **Issues:** `Feature: Fleet overview grid (sort, filter, skeletons)`; `Feature: Actions/CI status column + drill-down`; `Feature: Open PRs with new outside-contributor highlighting`; `Feature: Security alerts (Dependabot + code-scanning) with grade`; `Feature: Review-requested queue`; `Feature: Issues overview (counts + recent activity)`; `Feature: Stale PR/issue detection`; `Feature: Row drill-down drawer (CI/Security/PRs/Issues/Stale tabs)`.
- **Depends on:** M2 (data) + M3 for live data (features unit‑tested against mocks).
- **Exit:** all 7 PRD features meet their acceptance criteria (`PRD.md` §4); default "most broken" sort; client‑side filter; skeleton/partial‑error/empty states.
- **Research:** `research-ux` REC‑1…REC‑8, `research-api` §1.

### M5 · Privacy network‑interception test  — ✅ DoD (privacy invariant)
- **Issues:** `Test: privacy network-interception (GitHub-origins-only) + CSP`.
- **Depends on:** M3 + at least the grid + one live feature (M4).
- **Exit:** Playwright test asserts **0** requests to non‑GitHub origins; strict CSP (`connect-src` GitHub‑owned only) in place; fonts/assets bundled locally (`MISSION.md` §5, `research-auth` §2.3).

### M6 · Deploy — GitHub Pages  — ✅ DoD (live URL)  🚨 cofounder flips the switch
- **Issues:** `GitHub Pages deploy pipeline (base path + SPA fallback)`.
- **Depends on:** M1 (build) + M4; **go‑live gated by DECISION issue #1** (enable Pages).
- **Exit:** Vite base‑path + SPA‑fallback config; Pages deploy workflow authored (pre‑authorized); production deploy activated by the cofounder; live URL loads with no console errors.

### M7 · Polish — accessibility / performance / security
- **Issues:** `Accessibility pass (WCAG 2.1 AA)`; `Performance pass (50-repo fleet, polling efficiency)`.
- **Depends on:** M4 (+ M2 for perf).
- **Exit:** WCAG 2.1 AA checklist (`research-ux` Part 3) verified — keyboard grid nav, focus management, contrast, color‑independent status, reduced‑motion, light/dark both AA; 50‑repo fleet renders smoothly and stays within the rate‑limit budget.

### M8 · Docs — README + LICENSE + CONTRIBUTING  — ✅ DoD (README)
- **Issues:** `README with screenshots/GIF + one-click 'use it now' link`; `Add LICENSE (MIT)`; `Add CONTRIBUTING guide`.
- **Depends on:** M6 (use‑it‑now link target) + M4 (screenshots).
- **Exit:** README has screenshots/GIF + one‑click "use it now" link; LICENSE + CONTRIBUTING present.

### M9 · Release — Definition‑of‑Done verification
- **Issues:** `Release / Definition-of-Done verification checklist`.
- **Depends on:** M2, M3, M5, M6, M7, M8.
- **Exit:** every ✅ DoD item above is verified and checked off; v1 declared shippable.

### M10 · At‑a‑glance Dashboard view  — ✅ delivered (post‑MVP enhancement)
*A spatial, customisable alternative to the table grid (issue #113).*
- **Issues:** `Dashboard layout model + persistence` (#109); `SignalTile + DashboardView + view toggle` (#110); `Edit mode: pointer drag + resize` (#111); `Keyboard‑accessible reorder + resize (WCAG‑AA gate)` (#112); `Fleet summary tile + M10 docs` (#113).
- **Depends on:** M4 (signals + drill‑down) + M7 (a11y bar).
- **Exit (all delivered):** a **Grid / Dashboard** toggle (persisted under `fleet:view`); one **glanceable tile per (repo, signal)** on react‑grid‑layout reusing the grid's icon+colour+text cells; an **edit mode** with pointer **drag/resize** and a **keyboard** Move/Resize equivalent following the WAI‑ARIA grid pattern (roving tabindex, arrow nav, `aria-live` announcements, reduced‑motion aware) — **WCAG 2.1 AA**; **layout persistence** (debounced `localStorage`, reconciled against the fleet); and a **pinned fleet summary** tile (broken / warning / healthy rollup, never colour alone). See ADR‑010/011.

### M11 · Notifications Inbox  — post‑MVP (cofounder‑approved direction)
*A third top‑level `FleetView` (`'inbox'`): one triageable, newest‑first list of everything across the fleet that needs you — a **pure transform of already‑fetched signal data**. Design contract: `docs/DESIGN-INBOX.md`.*
- **Issues:** `Inbox item model + stable‑ID grammar`; `Signal enrichment: the four request-free retains (no new requests)`; `Signal enrichment: security per-alert cache (persist rows + replay on 304)`; `deriveInboxItems pure transform`; `Triage store (localStorage + Zod, capped/pruned)`; `useInbox hook (sort + filters + unread count)`; `Inbox view/list/row + states (WCAG‑AA gate)`; `FleetView 'inbox' + ViewToggle wiring + unread badge`.
- **Depends on:** M4 (the five signals) + M7 (a11y bar) + M10 (view‑toggle pattern).
- **Exit:** a **Grid / Dashboard / Inbox** toggle (persisted under `fleet:view`); a flat **newest‑first** list of five actionable kinds — **failing CI**, **review‑requested PRs**, **new outside‑contributor PRs**, **security alerts** (with severity), **stale PRs/issues** — each a **pure transform of data the app already fetches** (no new token permission, no new request/datasource, no write‑back to GitHub); **per‑device triage** (read · dismiss/archive · "new since last visit" · unread count) persisted in `localStorage`, **Zod‑validated and capped/pruned**; **WCAG 2.1 AA** in both themes (keyboard‑operable, never colour alone). Approved live with the cofounder as a post‑MVP direction. See `docs/DESIGN-INBOX.md`.

---

## Milestone → issue map

| Milestone | Seed issues | DoD |
|-----------|-------------|-----|
| M1 Scaffold + CI | scaffold · CI/quality‑gates | — |
| M2 Integration layer | integration‑layer port · ETag/rate‑limit | ✅ rate‑limit |
| M3 Auth (PAT) | PAT auth + token storage | ✅ PAT (gated by #3) |
| M4 7 features | fleet‑grid · ci‑status · open‑PRs · security · review‑queue · issues · stale · drawer | MVP |
| M5 Privacy test | privacy network‑interception | ✅ privacy |
| M6 Deploy | Pages deploy pipeline | ✅ live URL (gated by #1) |
| M7 Polish | a11y pass · perf pass | a11y quality bar |
| M8 Docs | README · LICENSE · CONTRIBUTING | ✅ README |
| M9 Release | DoD verification checklist | ✅ gate |
| M10 Dashboard view | layout model · tiles+toggle · drag/resize · keyboard a11y · summary+docs | ✅ delivered |
| M11 Notifications Inbox | item model · source enrichment (4 retains + security 304 cache) · derive · triage store · useInbox · view+states · toggle+badge | post‑MVP |

## Out of scope for v1 (post‑MVP backlog — `MISSION.md` §4)
Release/version tracking · discussions monitor · write
actions · secret‑scanning · OAuth device flow (until CORS or an approved proxy).
