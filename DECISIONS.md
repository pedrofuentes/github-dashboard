# Architecture Decision Records — github-dashboard

> **Record every significant technical decision here.** When choosing between approaches,
> document what was chosen and why. This prevents future agents and developers from
> re-debating settled decisions or accidentally reversing them.
>
> Do NOT write decisions to AGENTS.md — they belong here.

## Format

```markdown
### ADR-NNN: Decision Title
**Date**: YYYY-MM-DD
**Status**: Proposed / Accepted / Superseded by ADR-NNN
**Context**: What problem or question prompted this decision?
**Decision**: What was decided?
**Alternatives considered**: What other options were evaluated?
**Consequences**: What are the trade-offs? What does this enable or prevent?
```

## Decisions

<!-- Add new decisions below this line, most recent first -->

> ADR-001 … ADR-006 are the **foundational architecture set** (all 2026-06-19), recorded
> as one batch and presented in dependency order (structure → integration → auth →
> privacy → state → deploy). They are reflected in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
> Later, unrelated decisions are added above this set, most recent first.

### ADR-007: Conditional caching for the Link-paginated alert feeds (`sort=updated` 304 short-circuit)
**Date**: 2026-06-19
**Status**: Accepted
**Context**: The Security column grades each repo from its open **Dependabot + code-scanning** alerts. Either feed can exceed one page, so both must follow `Link: rel="next"` to count every alert instead of silently undercounting a repo with >100 open alerts (#63). Reading the `Link` header requires response-**header** access, so these feeds cannot route through the body-only `fetchWithETag` wrapper used elsewhere — when code-scanning moved to direct header-reading fetches (#76) it **lost** the ETag/`304` conditional-request savings that the rest of the data layer relies on (ADR-002). We needed to restore those savings without reintroducing an undercount, because a naïve "page-1 conditional, single-page-only" short-circuit can hide alerts that re-enter the open set on a later page (#78).
**Decision**: Pin **both** alert feeds to `state=open&per_page=100&sort=updated&direction=desc` and cache — keyed by the page-1 URL — the last **fully-counted** severity summary plus page 1's `ETag`. On the next read, replay that `ETag` as an `If-None-Match` validator **on page 1 only**:
- A `304 Not Modified` means page 1 is byte-identical **and**, because the feed is sorted by `updated_at` desc, the newest `updated_at` has not advanced — so nothing has entered the open set since the last read. The cached summary is reused verbatim and pages 2..N are not re-fetched (a `304` costs **0** against the primary limit).
- Any `200` re-paginates (up to `MAX_ALERT_PAGES`) and recounts from scratch.

This is correctness-preserving because every **new or reopened** alert gets `updated_at = now` and floats to the head of page 1 — changing page 1's bytes/`ETag` → `200` → full recount (GitHub preserves the original `created_at` on reopen). The **only** residual `304` case is an alert dismissed/fixed off page ≥2 that leaves page 1's 100 items unchanged: that yields a transient **over**-count until page 1 next changes — the grade errs toward "needs attention" and **never hides risk**. **Truncated reads are never cached** (the feed reader's `commit` is a no-op when the `MAX_ALERT_PAGES` cap stopped pagination with pages remaining), so a lower-bound tally can never be replayed as an "unchanged" `304` — this is what makes the partial-grade indicator (#77) safe.
**Alternatives considered**: `sort=created` (the API default) — **rejected**: a reopened alert keeps its old `created_at`, re-enters on page ≥2, and leaves a multi-page feed's page 1 unchanged → `304` → its (possibly **critical**) count is silently dropped — an UNDER-report in the **unsafe** direction. This was the #78 bug. A single-page-only conditional with no sort guarantee has the same hazard (any change off page 1 is invisible to a page-1 validator). Dropping conditional caching entirely and always full-paginating is correct but forfeits the `304` savings the 5,000 req/hr budget depends on (the #76 regression). **Batched GraphQL** for the alert feeds — **deferred**: GraphQL has no HTTP conditional caching (no `ETag`/`304` savings; ADR-002), and the alert connections are read via REST + `Link` pagination today; migrating them is a future optimization, not required for v1's budget.
**Consequences**: Conditional caching is restored for the header-reading alert feeds with a guarantee that a `304` short-circuit can only ever **over**-count (safe direction), never under-count. The cost is one extra ordering constraint (`sort=updated&direction=desc`) baked into both feed URLs plus the rule that truncated reads must not seed the cache. Migrating either feed to GraphQL later would need its own conditional-freshness story (or accept full re-reads each poll) — revisit via a superseding ADR.

### ADR-001: App & module structure
**Date**: 2026-06-19
**Status**: Accepted
**Context**: github-dashboard ships as a private, zero-install, client-only SPA hostable on GitHub Pages with no backend (`MISSION.md` §2). It needs a typed, component-based UI, fast dev/build, and runtime validation of untrusted GitHub API payloads. The stack is pinned by `MISSION.md` §3.
**Decision**: Build a single-package, client-only app with **Vite + React 18 + TypeScript (strict) + Tailwind + Zod**, npm, ES modules. Source is organized as `src/{api,components,hooks,lib,types}` plus `App.tsx` and `main.tsx`, with `tests/`, `public/` (locally bundled assets), and `docs/`. Conventions: **named exports**, **functional components + hooks**, no class components, no backend code. Module dependency direction is one-way: `lib/` ← `api/` ← `hooks/` ← `components/`.
**Alternatives considered**: Create React App (deprecated, slow); Next.js (SSR/route handlers imply a server — violates the no-backend invariant); plain TypeScript without React (excessive boilerplate for a data-grid UI); non-strict TS (loses type safety exactly at the API boundary where drift is the main risk).
**Consequences**: Fast HMR and a static, trivially deployable bundle; typed, validated boundaries. Strict TS + Zod add a little upfront typing cost but catch GitHub API drift early. No SSR/server-only features are available (acceptable — none are needed). The fixed directory layout and dependency direction keep network I/O confined to `api/` and pure logic in `lib/`.

### ADR-002: GitHub API integration layer (port from stream-deck-github-utilities)
**Date**: 2026-06-19
**Status**: Accepted
**Context**: We need REST + GraphQL access for the seven fleet signals, validated and rate-limit-safe at 50-repo scale, entirely in-browser (no backend, no webhooks). Substantial tested prior art exists in `pedrofuentes/stream-deck-github-utilities` (`research-portart`).
**Decision**: **Port the ~80% browser-safe data layer** from `pedrofuentes/stream-deck-github-utilities` (SHA `8e27e96…`, MIT): `src/utils/github-api/*` (`core`, `schemas`, `repos`, `pull-requests`, `issues-releases`, `workflows`, `security-branches`, `datasources`), `github-graphql.ts`, `graphql-query-builder.ts`, `data-fragments.ts`, `fragment-strategies.ts`, `repo-data-cache.ts`, `polling-coordinator.ts`, `graphql-query-coordinator.ts`, `github.ts`, and the data-layer portion of `types.ts`. Total adaptation is **~8 lines** (`streamDeck.logger` → `console`, drop the `@elgato/utils` `JsonValue` import, rename the `User-Agent`). On top of the port (all per `research-portart` §5):
- **Zod-validate every response** (`.passthrough()` schemas) before use.
- **`fetchWithRetry`** — ≤3 retries, exponential backoff (1 s / 2 s / 4 s), retry only `[429, 502, 503, 504]`, honor `Retry-After`; non-retryable codes pass through.
- **`GET /rate_limit` pre-check** before each batch (free, uncounted).
- **Visibility-aware polling** via `PollingCoordinator` (generation counter drops stale async results; stop when the tab is hidden).
- **Batched GraphQL** — alias ~10 repos per query for cross-repo refresh.
- **NET-NEW (absent in the source): ETag / `If-None-Match` conditional caching** — cache `{url → {etag, data}}`; a `304` costs **0** against the primary limit (`research-api` §2; `research-portart` §7.1).

**Rate-limit budget** (`research-api` §2): 50 repos @ 5-min polling ≈ **~1,200 REST req/hr without ETags**, **<300/hr with ETags** — far under the **5,000 req/hr** ceiling (GraphQL is a separate 5,000 pts/hr bucket). Org-level Dependabot + code-scanning endpoints collapse 50 per-repo calls into **1 each**; issue counts, staleness, and outside-contributor detection are computed from already-cached payloads (0 extra calls).
**NOT reusable** (`research-portart` §6): the Stream Deck rendering/action layer — `button-renderer`, `touch-strip-renderer`, `pi-data-provider`, `spinner-animator`, `marquee-controller`, all `@action` classes, `@elgato/streamdeck`, `@resvg/resvg-js`. DOM/React rendering is built fresh.
**Alternatives considered**: Octokit.js (heavier/generic; still needs our Zod + ETag layer and lacks the ported grading/coordinators); a fresh hand-written client (discards tested logic); GraphQL-only (forfeits ETag savings — GraphQL has no HTTP conditional caching).
**Consequences**: A large head-start of tested code with only one net-new subsystem (ETag) to build and test carefully (it is the main budget risk — `PRD.md` R3). Polling + ETag + visibility scheduling is the sanctioned approach because a client-only SPA cannot use webhooks. Stats endpoints' HTTP 202 "computing" sentinel (`-1`) must be surfaced as a transient state.

### ADR-003: Auth & token storage  — SIGNED OFF (DECISION issue #3)
**Date**: 2026-06-19
**Status**: Accepted — **signed off by @pedrofuentes** in DECISION issue #3 (option A), the HUMAN-REQUIRED auth gate (`MISSION.md` §9).
**Context**: Auth/token-storage/privacy is a HUMAN-REQUIRED decision. `research-auth` is conclusive: **device flow, Authorization-Code + PKCE, and Implicit grant are all CORS-blocked** from a pure SPA — GitHub's `github.com/login/*` token endpoints return no `Access-Control-Allow-Origin`; only `api.github.com` sends CORS. A backend/proxy would be required to complete any OAuth flow.
**Decision**: **v1 auth = a fine-grained, read-only Personal Access Token**, pasted once. **7 read-only permissions** (`research-api` §3): Actions · Code scanning alerts · Contents · Dependabot alerts · Issues · Metadata · Pull requests. **Token storage** (`research-auth` §2.5): **in-memory by default**; opt-in "remember this session" → `sessionStorage`; opt-in "remember across sessions" → `localStorage`; an **always-visible "Forget token"** clears all three. **No Web-Crypto encryption** — with no backend secret it adds no real XSS protection ("encryption theater"); the real mitigation is the strict CSP + no-third-party-scripts rule (ADR-004). **Device flow is DEFERRED** for v1 (it needs a proxy = a future gated decision); the PKCE *authorize* redirect may be pre-built speculatively without shipping the CORS-broken token exchange.
**Alternatives considered**: Device flow / OAuth now (CORS-blocked without a backend/proxy — violates no-backend); Web-Crypto-encrypted persistence (complexity with no real protection against same-origin XSS); always-`localStorage` (higher persistence risk than the in-memory default).
**Consequences**: The PAT path is fully self-contained and works today against `api.github.com`. No zero-PAT onboarding in v1 (accepted; deferred with written rationale + sign-off per `MISSION.md` §8). A read-only token bounds the blast radius of any leak. **No auth/token-persistence code may ship outside this signed-off design.**

### ADR-004: Privacy & network boundary
**Date**: 2026-06-19
**Status**: Accepted
**Context**: The privacy invariant (`MISSION.md` §5) requires that the token and all data stay in the browser, with no telemetry and no third parties. This must be **enforced and verifiable**, not merely intended.
**Decision**: Restrict the **runtime network allowlist to GitHub-owned origins only**: `api.github.com` (REST + GraphQL), `github.com` (origin-wide; reserved for the future `github.com/login/*` auth flow), and `*.githubusercontent.com` (avatars / raw images). Ship a **strict Content-Security-Policy** whose `connect-src` is limited to those GitHub-owned origins plus `'self'`. The shipped policy (`index.html`) is `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' https://*.githubusercontent.com data:; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self' https://api.github.com https://github.com https://*.githubusercontent.com; form-action 'self'`. Note `*.githubusercontent.com` is allowed in **both** `img-src` (so `<img>` avatars render) and `connect-src`, and the future auth origin currently ships as the **origin-wide** `https://github.com` — path-scoping it to `github.com/login/*` is deferred to a header-capable host (see ARCHITECTURE §10), not the v1 `<meta>` policy. **Bundle fonts/assets locally** — no CDN/analytics/third-party origins. Forbid `eval()`/`new Function()`; render API strings via `textContent`, never `innerHTML`. **Verify with an automated Playwright network-interception test** asserting **0** requests to non-GitHub origins (a Definition-of-Done item; `ROADMAP.md` M5).
**Alternatives considered**: CDN-hosted fonts/analytics (introduces third-party origins and XSS surface — forbidden by `MISSION.md` §5); relying on code review alone (not verifiable — the automated test is the real gate).
**Consequences**: A strong, testable privacy guarantee and a minimal XSS surface (the actual protection for a persisted read-only token, since encryption is rejected in ADR-003). Self-hosting fonts/assets slightly enlarges the bundle. Adding **any** new runtime origin (including a future auth proxy) becomes a gated decision. Note: the token-validation avatar check (`validateToken` / `sanitizeAvatarUrl`) admits the bare apex `githubusercontent.com` in addition to sub-domains — one step broader than the `*.githubusercontent.com` wildcard above — but the `img-src https://*.githubusercontent.com` CSP directive is the browser-level backstop (GitHub serves avatars only from sub-domains such as `avatars.githubusercontent.com`).

### ADR-005: State management
**Date**: 2026-06-19
**Status**: Accepted
**Context**: The app manages token/auth state, fleet/repo data, async polling/cache lifecycle, and UI state (sort, filter, column visibility, drawer, thresholds). `MISSION.md` §3 pins the stack to React/Vite/Tailwind/Zod and lists no state-management library.
**Decision**: Use **React built-ins only — Context + hooks + `useReducer`** — together with the **ported coordinators** (`RepoDataCache`, `PollingCoordinator`, `GraphQLQueryCoordinator`) for data/async state. **Add no extra state-management dependency** (no Redux/Zustand/Jotai/React-Query). UI preferences (sort, filter, column visibility, stale thresholds) persist to **`localStorage`** (`research-ux` REC-6 / REC-10).
**Alternatives considered**: Redux/Zustand/Jotai (a dependency beyond `MISSION.md` §3 — gated; unnecessary at this scope); React Query / SWR (overlaps the already-ported cache + polling coordinators and adds a dependency).
**Consequences**: Zero added dependencies, staying within `MISSION.md` §3; the coordinators already encapsulate cache-first fetching, de-duplication, sibling notification, and backoff. Coordinators must be held in a `useRef` (not re-instantiated per render); the generation counter discards stale async results. If global state later grows unwieldy, revisit via a superseding ADR.

### ADR-006: Deploy / distribution
**Date**: 2026-06-19
**Status**: Accepted — Pages enabled via DECISION issue #1 (approved by @pedrofuentes).
**Context**: The product is distributed as a zero-install public URL on **GitHub Pages** (`MISSION.md` §2, §8). Pipeline authoring is pre-authorized (`MISSION.md` §9); **activating Pages / production go-live is the cofounder's toggle** (HUMAN-REQUIRED).
**Decision**: Deploy to **GitHub Pages via GitHub Actions** (`build_type: workflow`). Set Vite **`base: '/github-dashboard/'`** so assets resolve under the project path, and add an **SPA fallback** by copying `index.html` → `404.html` so deep links resolve client-side. Pages is **enabled** (DECISION issue #1) on the **custom domain `pedrofuent.es`** with **`https_enforced: true`** (HTTPS certificate approved); the live URL is **`https://pedrofuent.es/github-dashboard/`**. **Security rationale**: the PAT-entry app MUST be served **only over a secure HTTPS origin** so the page and its strict CSP cannot be tampered with in transit — an on-path attacker on a plain-HTTP channel could rewrite the HTML/JS or the CSP and exfiltrate the pasted read-only token (ties to ADR-004's network boundary and `PRD.md` risk R5). Pipeline authoring is pre-authorized; the deploy **workflow is authored in issue #7** and the **live URL is verified in the release / Definition-of-Done phase (#25)** — production go-live is **not "done"** until that secure deploy is verified.
**Alternatives considered**: `gh-pages`-branch deploy (option B in issue #1 — not chosen; the Actions source matches the authored workflow); third-party static hosts such as Netlify/Vercel (off-platform third parties — GitHub Pages keeps everything GitHub-owned, consistent with ADR-004).
**Consequences**: Fully static, no server. The base path means all asset URLs are prefixed with `/github-dashboard/`; the `404.html` fallback enables client-side routing and deep links. The custom domain is provisioned with an approved HTTPS certificate and **`https_enforced: true`**, so the origin — and the strict CSP it carries — is delivered only over TLS; this is required because a read-only PAT is pasted into this page (ADR-004, `PRD.md` R5). Go-live remains a human toggle: Pages is **enabled** (DECISION #1) over enforced HTTPS, but production go-live is **not satisfied** until the deploy workflow (issue #7) ships and the live URL is verified in the release / DoD phase (#25).
