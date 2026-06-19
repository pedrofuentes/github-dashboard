# Architecture

> Authoritative architectural context for **github-dashboard**. Referenced from
> [`AGENTS.md`](../AGENTS.md) (§Code Style → §Code Patterns) and grounded in the
> decision records in [`DECISIONS.md`](../DECISIONS.md) (ADR-001 … ADR-006).
> Keep this file current — it is the canonical source for structure, data flow,
> module boundaries, and code patterns. It must not contradict
> [`MISSION.md`](../MISSION.md) or [`PRD.md`](../PRD.md).

**Phase:** Architecture recorded (Phase 1). **Last updated:** 2026-06-19.

---

## 1. Overview

github-dashboard is a **private, client-only React SPA** that gives a maintainer a
cross-repo *fleet-health* view (CI, security, review queue, outside-contributor
PRs, issues, staleness). It is **fully self-contained**: there is **no backend,
no server, and no proxy** — the user's token and data never leave the browser
except for calls to GitHub-owned origins (`MISSION.md` §2, §5).

The stack is **Vite + React 18 + TypeScript (strict) + Tailwind + Zod**, built and
deployed as static files to **GitHub Pages**. The GitHub data layer is **ported
~80%** from `pedrofuentes/stream-deck-github-utilities` and hardened with a
**net-new ETag conditional-caching layer**. Auth is a **fine-grained read-only
PAT** held in-memory by default. Privacy is enforced by a **strict CSP +
GitHub-only network allowlist** and verified by an automated test.

## 2. Decision index

The architecture is governed by six foundational ADRs (full text in
[`DECISIONS.md`](../DECISIONS.md)):

| ADR | Governs | One-line summary |
|-----|---------|------------------|
| **ADR-001** | App & module structure | Vite + React 18 + TS (strict) + Tailwind + Zod; client-only; `src/{api,components,hooks,lib,types}`; named exports, functional components + hooks. |
| **ADR-002** | GitHub API integration layer | Port the ~80% browser-safe data layer from `stream-deck-github-utilities`; Zod-validate every response; `fetchWithRetry` + backoff; **net-new ETag/`If-None-Match`** caching; `/rate_limit` pre-check; visibility-aware polling; batched GraphQL. |
| **ADR-003** | Auth & token storage *(signed off, issue #3)* | Read-only fine-grained PAT (7 permissions); in-memory default + opt-in `sessionStorage`/`localStorage` + "Forget token"; device flow deferred (CORS). |
| **ADR-004** | Privacy & network boundary | GitHub-owned origins only; strict CSP (`connect-src` GitHub-only); fonts/assets bundled locally; verified by a Playwright network test. |
| **ADR-005** | State management | React Context + hooks + `useReducer` + ported coordinators; **no extra state library**. |
| **ADR-006** | Deploy / distribution | GitHub Pages via Actions; Vite `base: '/github-dashboard/'`; `404.html` SPA fallback; custom domain `pedrofuent.es`. |

## 3. Project structure

Single-package, client-only Vite + React SPA (no backend, no monorepo). Target
layout (directories under `src/` created as the milestones land):

```
github-dashboard/
├── src/
│   ├── api/         ← GitHub REST + GraphQL client: ported core (fetchWithRetry,
│   │                  buildHeaders, handleApiError), Zod schemas, ETag cache,
│   │                  coordinators (repo-data-cache, polling, graphql-query)
│   ├── components/  ← Functional React components (fleet grid, repo rows,
│   │                  health badges, drill-down drawer) — the only renderers
│   ├── hooks/       ← Data-fetching / caching / polling hooks bridging api → UI
│   ├── lib/         ← Pure helpers: security grading, staleness, ahead/behind,
│   │                  rate-limit budgeting, token-storage helper (no React/IO)
│   ├── types/       ← Shared TypeScript types (incl. ported data-layer types)
│   ├── App.tsx
│   └── main.tsx     ← Vite entry point
├── tests/           ← Vitest unit/integration + Playwright e2e (privacy network test)
├── public/          ← Locally bundled static assets (fonts, icons) — no CDNs
├── docs/            ← Architecture, testing strategy, Sentinel, workflow
├── index.html       ← Vite HTML entry (hosts the strict CSP meta tag)
├── 404.html         ← SPA fallback (copy of index.html) for GitHub Pages deep links
├── vite.config.ts   ← base: '/github-dashboard/', build config
├── AGENTS.md · MISSION.md · PRD.md · ROADMAP.md · DECISIONS.md · LEARNINGS.md
├── package.json
└── LICENSE · README.md
```

## 4. Module boundaries & dependency direction

Dependencies flow **one way**; `api/` is the **only** module that performs network
I/O, and `lib/` is **pure** (no React, no `fetch`):

```
types/  ──┐ (shared types, no deps)
          ▼
lib/    ──►  pure functions: computeGrade, staleness, ahead/behind,
          │  rate-limit budgeting, token-storage helper  (no React, no I/O)
          ▼
api/    ──►  REST + GraphQL client + ETag cache + coordinators
          │  (the ONLY network I/O; validates with Zod; depends on types/, lib/)
          ▼
hooks/  ──►  React data hooks: subscribe to coordinators, expose {data, loading,
          │  error, refresh} to components (depends on api/, lib/, types/)
          ▼
components/ ► presentational + container React components (depends on hooks/,
             lib/, types/) — render to the DOM; never call fetch directly
```

**Rule:** components never import from `api/` directly — they consume `hooks/`.
This keeps network access, retries, ETag handling, and rate-limit logic in one
place and makes the UI trivially testable against mocked hooks.

## 5. Data flow

1. The user pastes a **read-only PAT** (ADR-003). It is held **in-memory by
   default** (optionally mirrored to `sessionStorage`/`localStorage`), never sent
   anywhere except GitHub-owned origins.
2. A `hooks/` subscription asks a **coordinator** (`GraphQLQueryCoordinator` /
   `PollingCoordinator`) for a repo's data. The coordinator is **cache-first**:
   it serves fresh entries from `RepoDataCache` and fetches only **stale**
   fragments.
3. Before each batch, the client does a free **`GET /rate_limit`** pre-check.
   Requests are sent through `api/core` `fetchWithRetry` with **`If-None-Match`**
   (ETag) headers. A **`304`** returns cached data at **0 rate-limit cost**; a
   **`200`** payload is **Zod-validated** (`.passthrough()`), stored with its new
   ETag, and returned.
4. Coordinators apply **backoff** on errors, **stop when the tab is hidden**, and
   use a **generation counter** to discard stale async results.
5. Validated data surfaces through `hooks/` to `components/`, which render the
   grid and drawer. Per-cell errors degrade a single cell, not the whole row
   (`PRD.md` §5 REC-7).

All traffic targets **GitHub-owned origins only** (ADR-004). No user code or data
reaches any third party.

## 6. Diagrams (as text)

### 6.1 Poll → fetch → render sequence (with ETag + rate-limit guard)

```
component (mount)
   │ subscribe(repo)
   ▼
hook ──► coordinator.fetchData(repo, token)
                │  cache-first: any stale fragments?
                │      no ─► return cached ─► hook state ─► render
                │      yes
                ▼
            GET /rate_limit  (free, uncounted)  ──► remaining low? ─► banner (no silent stop)
                │ ok
                ▼
        fetchWithRetry(url, { headers: …, 'If-None-Match': etag })
                │
                ├─ 304 Not Modified ─► reuse cached data        (0 cost)
                ├─ 200 OK ─► Zod.parse(payload) ─► cache.set(etag, data)
                ├─ 429/403(rl) ─► honor Retry-After / reset; exp backoff; degraded mode (stale data)
                └─ 5xx [502/503/504] ─► retry ≤3 (1s,2s,4s)
                ▼
        coordinator notifies subscribers ─► hook state ─► component re-render
```

### 6.2 Network boundary (CSP allowlist)

```
┌─────────────────────────── Browser (GitHub Pages origin) ───────────────────────────┐
│  React SPA  +  in-memory PAT  +  RepoDataCache (ETags, validated data)                │
│        │  fetch (allowed by CSP connect-src)                                          │
│        ▼                                                                              │
│  ALLOWED ────► api.github.com            (REST + GraphQL; sends CORS)                 │
│  ALLOWED ────► github.com/login/*        (future auth; CORS-blocked → device flow deferred) │
│  ALLOWED ────► *.githubusercontent.com   (avatars / raw images)                      │
│  BLOCKED ──X─► any other origin (CDNs, analytics, fonts, telemetry) — no third parties │
└──────────────────────────────────────────────────────────────────────────────────────┘
Verified by an automated Playwright network-interception test: 0 non-GitHub requests.
```

## 7. Integration layer (the port)  — ADR-002

The data layer is **~80% portable** from `pedrofuentes/stream-deck-github-utilities`
(SHA `8e27e96…`, MIT) with **~8 total lines** of adaptation (`research-portart` §5, §8).

**Port (browser-safe, `zod`-only):** `github-api/core` (`fetchWithRetry`,
`fetchWithTimeout`, `buildHeaders`, `parseRateLimitHeaders`, `parseRetryAfter`,
`handleApiError`, `classifyErrorLabel`, `GitHubApiError`), `github-api/schemas`
(all Zod schemas, `.passthrough()`), the per-domain modules (`repos`,
`pull-requests`, `issues-releases`, `workflows`, `security-branches`,
`datasources`), `github-graphql`, `graphql-query-builder`, `data-fragments`,
`fragment-strategies`, `repo-data-cache`, `polling-coordinator`,
`graphql-query-coordinator`, `github` (validation/format utils), and the
data-layer types. Extract the **pure** `computeGrade` (security grading) and the
`↑N ↓M` ahead/behind formatter from the action files.

**Adaptations:** `streamDeck.logger.*` → `console.*` (3 sites); drop the
`@elgato/utils` `JsonValue` import (define inline); rename the `User-Agent`.

**Net-new (absent in the source — `research-portart` §7.1):** an **ETag /
`If-None-Match` conditional-cache** layered on `fetchWithRetry`, keyed
`{url → {etag, data}}`. Treat it as a first-class, separately-tested subsystem —
it is the main rate-limit risk (`PRD.md` R3).

**NOT reusable (`research-portart` §6):** the Stream Deck rendering/action layer —
`button-renderer`, `touch-strip-renderer`, `pi-data-provider`, `spinner-animator`,
`marquee-controller`, `render-debouncer`, all `@action` classes,
`@elgato/streamdeck`, `@resvg/resvg-js`, the rollup/plugin packaging. **DOM/React
rendering is built fresh.**

## 8. Rate-limit strategy  — ADR-002 (`research-api` §2)

Budget: **5,000 REST req/hr** and a **separate** 5,000 GraphQL points/hr (PAT).
Target scale 50 repos @ 5-min polling measures **≈1,200 req/hr without ETags** and
**<300/hr with ETags** — well under the ceiling.

- **ETag / `If-None-Match`** on every REST endpoint → `304` = **0 cost** (~80% of
  idle-fleet polls become free).
- **Org-level Dependabot + code-scanning** endpoints collapse 50 per-repo calls
  into **1 each**.
- **Compute from cache:** issue counts, staleness, and outside-contributor
  detection reuse already-fetched payloads (**0** extra calls).
- **`GET /rate_limit` pre-check** before each batch (free); surface a dismissible
  banner when remaining is low — **never silently stop**.
- **Stop polling when the tab is hidden** (Page Visibility API); **stagger**
  requests under secondary limits (≤100 concurrent, ≤900 REST pts/min); honor
  `Retry-After` with exponential backoff; show **degraded mode** with last-known
  cached data on persistent limiting.
- **Batched GraphQL** (~10 repo aliases/query) for cross-repo PR refresh.
- **No webhooks** are available to a client-only SPA — polling + ETag is the
  sanctioned approach.

## 9. Auth & token storage  — ADR-003 (signed off, issue #3)

- **v1 auth = fine-grained, read-only PAT**, pasted once. **7 read-only
  permissions** (`research-api` §3): Actions · Code scanning alerts · Contents ·
  Dependabot alerts · Issues · Metadata · Pull requests.
- **Storage:** **in-memory by default**; opt-in "remember this session" →
  `sessionStorage`; opt-in "remember across sessions" → `localStorage`; an
  always-visible **"Forget token"** clears all three.
- **No Web-Crypto encryption** — with no backend secret it adds no real XSS
  protection; the strict CSP + no-third-party-scripts rule (ADR-004) is the real
  mitigation. A read-only token bounds blast radius.
- **Device flow DEFERRED** — `github.com/login/*` token endpoints are CORS-blocked
  from a pure SPA (`research-auth`); it needs a proxy = a future gated decision.
  The PKCE *authorize* redirect may be pre-built speculatively without the broken
  token exchange.

## 10. Privacy & network boundary  — ADR-004

- **Runtime allowlist — GitHub-owned only:** `api.github.com`,
  `github.com/login/*`, `*.githubusercontent.com`.
- **Strict CSP** with `connect-src` limited to GitHub-owned origins; e.g.
  `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'
  https://*.githubusercontent.com; connect-src https://api.github.com;
  object-src 'none'`.
- **Fonts/assets bundled locally** — no CDN/analytics/third-party origins. No
  `eval()`/`new Function()`; render API strings via `textContent`, never
  `innerHTML`.
- **Verified** by an automated **Playwright network-interception test** asserting
  **0** requests to non-GitHub origins (`ROADMAP.md` M5, a DoD item).

## 11. State management  — ADR-005

- **React built-ins only:** Context + hooks + `useReducer`, plus the ported
  coordinators (`RepoDataCache`, `PollingCoordinator`, `GraphQLQueryCoordinator`)
  for data/async state. **No Redux/Zustand/Jotai/React-Query** (no dependency
  beyond `MISSION.md` §3).
- **Persist UI preferences** (sort, filter, column visibility, stale thresholds)
  in `localStorage` (`research-ux` REC-6 / REC-10).
- Hold coordinators in a **`useRef`** (never re-instantiate per render); the
  generation counter discards stale async results.

## 12. Deploy / distribution  — ADR-006 (Pages enabled, issue #1)

- **GitHub Pages via GitHub Actions** (`build_type: workflow`).
- Vite **`base: '/github-dashboard/'`** so assets resolve under the project path.
- **SPA fallback:** copy `index.html` → `404.html` so deep links resolve
  client-side.
- Pages is **enabled** with a **custom domain `pedrofuent.es`**; live URL
  **`http://pedrofuent.es/github-dashboard/`** (HTTPS cert approved;
  `https_enforced` currently `false`). Pipeline authoring is pre-authorized;
  production go-live is the cofounder's toggle (already flipped).

## 13. Code patterns

The conventions AGENTS.md §Code Style points to. (Illustrative — application code
is built in the feature milestones, not here.)

**Named exports + functional components + hooks** (no default exports, no classes):

```tsx
// components/HealthBadge.tsx
export function HealthBadge({ grade, label }: HealthBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={label}>
      <GradeIcon grade={grade} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}
```

**Validate every GitHub API response with Zod at the boundary** (schemas use
`.passthrough()` so new GitHub fields never break parsing):

```ts
// api/schemas.ts
export const WorkflowRunSchema = z
  .object({ id: z.number(), status: z.string(), conclusion: z.string().nullable() })
  .passthrough();

// api/workflows.ts — parse before the data is allowed into the app
const data = WorkflowRunsResponseSchema.parse(await res.json());
```

**Conditional requests (ETag) layered on the ported `fetchWithRetry`** — `304`
returns cached data at zero rate-limit cost (net-new vs. the port, ADR-002):

```ts
// api/etag-cache.ts (net-new)
export async function fetchWithETag<T>(url: string, schema: ZodType<T>, token: string): Promise<T> {
  const cached = etagCache.get(url);
  const headers = buildHeaders(token);
  if (cached?.etag) headers["If-None-Match"] = cached.etag;

  const res = await fetchWithRetry(url, { headers }, url);
  if (res.status === 304 && cached) return cached.data as T; // 0 cost
  const data = schema.parse(await res.json());
  etagCache.set(url, { etag: res.headers.get("ETag"), data });
  return data;
}
```

**Coordinators behind a `useRef` hook** (ADR-005) — instantiate once, subscribe,
stop on hidden tab:

```ts
// hooks/useRepoData.ts
export function useRepoData(repo: string, token: string) {
  const coordinator = useRef(getCoordinator()).current;
  const [state, setState] = useState<RepoDataState>({ loading: true });
  useEffect(() => coordinator.subscribe(repo, setState), [repo, token]);
  return state;
}
```

**Token storage — in-memory by default, opt-in persistence, always "Forget"**
(ADR-003):

```ts
// lib/token-store.ts
let inMemoryToken: string | null = null;
export function setToken(token: string, persist: "none" | "session" | "local") {
  inMemoryToken = token;
  if (persist === "session") sessionStorage.setItem("pat", token);
  if (persist === "local") localStorage.setItem("pat", token);
}
export function forgetToken() {
  inMemoryToken = null;
  sessionStorage.removeItem("pat");
  localStorage.removeItem("pat");
}
```

**Accessibility:** every status is conveyed by icon **and** text (`sr-only`),
never color alone; the grid follows the ARIA Data Grid pattern; sortable headers
expose `aria-sort` (`PRD.md` §6).

## 14. Key files

Files agents should know for orientation (created in later phases):

| File | Purpose |
|------|---------|
| `src/api/core.ts` | Ported request core — `fetchWithRetry`, `buildHeaders`, `handleApiError`, rate-limit header parsing |
| `src/api/etag-cache.ts` | **Net-new** ETag/`If-None-Match` conditional-cache layer (ADR-002) |
| `src/api/schemas.ts` | Zod schemas (`.passthrough()`) validating every GitHub response |
| `src/api/graphql-query-coordinator.ts` | Cache-first, batched GraphQL orchestration + REST fallback |
| `src/lib/token-store.ts` | In-memory-default token storage + opt-in session/local + Forget (ADR-003) |
| `index.html` / `404.html` | Vite HTML entry hosting the strict CSP; `404.html` is the SPA fallback (ADR-004, ADR-006) |
| `vite.config.ts` | `base: '/github-dashboard/'` + build config for GitHub Pages (ADR-006) |
| `tests/privacy.network.spec.ts` | Playwright network-interception test — GitHub-owned origins only (ADR-004) |
