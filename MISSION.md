# MISSION — github-dashboard

> Per-project brief read by [`docs/KICKOFF.md`](docs/KICKOFF.md) (the generic operating instructions). This is the only file with project-specific content; the generic prompt + companion docs fill everything else from it.

---

## 1. Identity & mission
- **Project name:** github-dashboard
- **Repo:** `pedrofuentes/github-dashboard`
- **Cofounder handle (for @-mentions on gated decisions):** @pedrofuentes
- **One-line mission:** A private, self-contained web dashboard that lets a maintainer of many GitHub repositories see fleet health at a glance — failing Actions, open and new-contributor PRs, security alerts, review requests, issues, and stale items.
- **Target users & the problem:** Maintainers who juggle many repos and have no single place to see, across all of them, what's broken, what's waiting on them, and what's risky.
- **Success vision:** Good enough that millions of GitHub maintainers use it; fast, private, zero-install, no backend.

## 2. Product shape
- **Product type:** static web SPA
- **Hosting / distribution:** GitHub Pages (static, no server)
- **Backend?** None — fully client-side / self-contained. The user's token and data never leave the browser except for calls to GitHub-owned origins. Adding any backend/proxy is a gated decision.
- **Design direction:** clean, information-dense dashboard; calm neutral palette with clear status accents (green/amber/red health signals); reuse Tailwind design tokens; reference feel: Linear and GitHub's own UI.

## 3. Tech stack
- **Language(s):** TypeScript
- **Framework(s) / key libraries:** React, Vite, Tailwind, Zod
- **Package manager:** npm
- **Test runner / e2e:** Vitest + Playwright
- **Visual verification:** Playwright (shared with e2e) — render + screenshot key views (overview grid, PR/alert panels, empty/error states) for the design loop.

## 4. MVP scope (v1)
1. **Fleet overview grid** — all selected repos at a glance with health signals.
2. **Actions/CI status** — surface failing/late workflow runs prominently.
3. **Open PRs** — with **new outside-contributor PRs** highlighted.
4. **Security alerts** — Dependabot/code-scanning, with a severity grade.
5. **Review-requested queue** — PRs awaiting *your* review, with urgency.
6. **Issues overview** — open/triage counts and recent activity.
7. **Stale detection** — PRs/issues with no activity past a threshold.
- **Explicitly out of scope for v1:** release/version tracking, notifications inbox, discussions monitor (post-MVP backlog).

## 5. Security, privacy & data
- **Auth model:** BOTH — (1) fine-grained, read-only Personal Access Token pasted once and stored in-browser (primary, fully self-contained); (2) OAuth **device flow** — best effort.
- **Privacy/data constraints:** token + all data live only in the browser; no telemetry, no third parties.
- **Network allowlist (runtime origins):** GitHub-owned only — `api.github.com`, `github.com/login/*` (auth), `avatars.githubusercontent.com` / `raw.githubusercontent.com` (images). Fonts/assets bundled locally; no third-party/CDN/analytics origins. Verify with a Playwright network-interception test.
- **Agent egress allowlist (the build fleet itself):** `github.com` / `api.github.com`, the **npm registry** (`registry.npmjs.org`), and named research/doc domains — separate from the product's runtime origins above. Deploy/Pages secrets live in GitHub **Environment** secrets, never in the repo or a worktree.
- **Known security risks to research up front:** GitHub's device-flow token endpoint has no browser CORS → a pure static page likely cannot complete the poll without a proxy/relay. **Do NOT silently add a backend** — research feasibility; if it genuinely needs a server, that's a gated decision (§9). Device flow may be deferred with a written rationale + cofounder sign-off.

## 6. Reuse & references
- **Prior art / code to study or port:** `https://github.com/pedrofuentes/stream-deck-github-utilities` — port/adapt its GitHub API client (REST + GraphQL, Zod schemas, `fetchWithRetry`), security grading, ahead/behind, and polling/caching. Rendering is built fresh for the DOM.
- **Design/UX references:** maintainer "fleet health at a glance" patterns (research in Phase 1).

## 7. Harness pre-answers
- **Coverage threshold:** 80 (Sentinel ratchets up; never decreases).
- **Git author identity (commits):** pedrofuentes <git@pedrofuent.es>
- **AI attribution (commit `Co-authored-by` trailer):** Copilot <223556219+Copilot@users.noreply.github.com>
- **Sentinel method:** B (CI, enforced by branch protection) for production + A (sub-agent) in dev.
- **Agent identity (for unattended runs):** a dedicated **machine-user** account (e.g. `@github-dashboard-bot`) — a **distinct** GitHub identity, NOT @pedrofuentes — that the agent authenticates as via a **fine-grained, single-repo** token (read/write: Contents, Issues, Pull requests, Projects, Actions). Required so decisions can't be forged and the agent can merge (author ≠ approver). This is the **upgrade path to fully-unattended (Tier-2)** operation; provision it when ready (the agent walks you through it). See `CONTINUOUS-OPERATION.md` §Agent identity.
- **Attended single-operator mode (opt-in)** — `attended-single-operator: yes — I accept running under my own identity while present`. Lets the build **start now** under @pedrofuentes while present: gate answers come through the **live CLI or a bounded-trusted async board channel** (self-signature + cofounder-login + solo-repo), it runs **Tier-1 only (no unattended Tier-2)**, and all other v2 protections stay on. Switch to the machine-user identity above to go fully unattended.
- **Enforced coding patterns:** client-only (no backend); validate every GitHub API response with Zod; conditional requests (ETag/`If-None-Match`) + batched GraphQL to respect the 5,000 req/hr limit; functional React components + hooks; named exports; accessible (WCAG 2.1 AA) components; secrets never touch the bundle.
- **Forbidden actions (NEVER):** commit a PAT or any secret; send user code/data to any non-GitHub origin (only `api.github.com`, `github.com/login/*`, `*.githubusercontent.com`); introduce a backend/server/proxy without explicit cofounder approval; bypass Sentinel.
- **Enable branch protection on `main`?** Yes.

## 8. Definition of Done (project-specific acceptance)
- A **live GitHub Pages URL** serves the SPA and loads without errors.
- Fine-grained-**PAT** path works end-to-end against real GitHub data; **device flow** implemented client-side *or* explicitly deferred with rationale + cofounder sign-off.
- **Privacy invariant** verified by the automated network test (GitHub-owned origins only).
- **Rate-limit safe:** conditional requests + batched GraphQL; degrades gracefully near 5,000 req/hr.
- README with screenshots/GIF + a one-click "use it now" link.
- Each acceptance item above is bound to an executable test id (`AC-1`…`AC-n`) checked on every PR + milestone (cumulative acceptance regression).

## 9. Authorization — tiers (defaults from the template `docs/KICKOFF.md` + `MISSION.md` §9; project specifics below)
The agent sorts every gated action into `auto` · `auto-with-audit` · `time-boxed` · `human-required` · `never` and acts per tier. For this project:
- **Default time-box (auto-proceed window):** 24h.
- **Risk tolerance:** conservative — the app holds a user's GitHub token, so borderline actions sit at `human-required`.
- **Production release gate:** human-required — *you* flip on GitHub Pages / activate the production deploy for each release; staging/preview is `auto`.
- **`time-boxed` (auto-proceed after 24h):** the next milestone *within `ROADMAP.md`*; a **built-UI design review** — the agent posts screenshots to a `DECISION:` issue and proceeds if you don't object.
- **`auto` (pre-authorized, no asking):** add the §3 stack deps (React, Vite, TypeScript, Tailwind, Vitest, Playwright, Zod, ESLint/Prettier, React Testing Library) + reasonable transitive tooling; **author** CI/CD workflow files (tests, lint/typecheck, Sentinel Method B, the Pages deploy pipeline) + the Vite base-path/SPA-fallback config; configure branch protection; routine **reversible** architecture consistent with this brief.
- **`human-required` (sign-off first):** auth / token-storage / privacy design (no auth/token-persistence code before sign-off); adding any backend / server / proxy or non-GitHub runtime origin (incl. for device-flow); heavy/unusual deps beyond §3; any `.github/workflows/**` edit or a harness-integrity PR (Sentinel config/prompt, `AGENTS.md`, branch protection, scanner config); a first-time-contributor PR.
- **`never`:** commit a PAT or any secret; send user code/data to a non-GitHub origin; weaken/bypass Sentinel, tests, branch protection, or the scanners (branch protection is tighten-only); force-push / rewrite `main`; delete branches/releases/tags/data.

## 10. Resource governance (concurrency & cost)
- **Max concurrent workers / worktrees:** 4 · **per-watchdog-tick spawn cap:** 3 · **per-milestone cost budget:** no hard cap (small project) — queue at the caps, finish in-flight work first.
