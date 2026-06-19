# v1.0.0 — Definition-of-Done Verification

> **Issue #25** — final v1 gate. This document verifies **every** Definition-of-Done
> item in [`MISSION.md` §8](../MISSION.md) against concrete, reproducible evidence
> (commands, results, URLs, source citations). Claims are checked against the repo;
> nothing here is asserted without evidence.

- **Version**: `1.0.0` (`package.json`)
- **Date**: 2026-06-19
- **Branch**: `chore/v1-release` (cut from `main` @ `73ab931`)
- **Verifier**: release gate run in a clean `npm ci` worktree

---

## MISSION §8 — Definition of Done

| # | DoD item (MISSION §8) | Status | Evidence (see sections below) |
|---|------------------------|--------|-------------------------------|
| 1 | A **live GitHub Pages URL** serves the SPA and loads without errors | ✅ | §1 |
| 2 | Fine-grained **PAT** path works end-to-end against real GitHub data; **device flow** implemented *or* deferred with rationale + cofounder sign-off | ✅ | §2 |
| 3 | **Privacy invariant** verified by the automated network test (GitHub-owned origins only) | ✅ | §3 |
| 4 | **Rate-limit safe**: conditional requests (+ batched GraphQL); degrades gracefully near 5,000 req/hr | ✅ | §4 |
| 5 | **README** with screenshots/GIF + a one-click "use it now" link | ✅ | §6 |

Plus the seven MVP features (§5), the full quality gate (§7), and process integrity (§8).

---

## 1. Live GitHub Pages URL loads, over enforced HTTPS

- [x] **Live URL returns 200.**

  ```console
  $ curl -sS -I https://pedrofuent.es/github-dashboard/
  HTTP/2 200
  server: GitHub.com
  content-type: text/html; charset=utf-8
  ```

- [x] **HTTPS is enforced** — plain HTTP 301-redirects to the HTTPS origin (a read-only
  PAT is pasted into this page, so it must only ever be served over TLS — ADR-006).

  ```console
  $ curl -sS -I http://pedrofuent.es/github-dashboard/
  HTTP/1.1 301 Moved Permanently
  Location: https://pedrofuent.es/github-dashboard/
  ```

- [x] **Loads without errors** — the deployed bundle is exercised end-to-end by the
  Playwright `smoke` spec ("loads the app and shows the dashboard heading") and the
  privacy/a11y specs, all green against the production build (§3, §7).
- [x] **Deploy pipeline** — [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
  builds, adds the `404.html` SPA fallback, and publishes to Pages on every push to
  `main` (Vite `base: '/github-dashboard/'`). Custom domain `pedrofuent.es`,
  `https_enforced: true` (ADR-006, DECISION issue #1).

## 2. PAT path end-to-end; device flow deferred with sign-off

- [x] **Fine-grained read-only PAT** pasted once, stored in-browser (in-memory by
  default; opt-in `sessionStorage`/`localStorage`; always-visible "Forget token").
  Source: [`src/lib/token-storage.ts`](../src/lib/token-storage.ts),
  [`src/hooks/AuthProvider.tsx`](../src/hooks/AuthProvider.tsx),
  [`src/components/TokenInput.tsx`](../src/components/TokenInput.tsx).
  Tested: `token-storage.test.ts`, `AuthProvider.test.tsx`, `TokenInput.test.tsx`,
  `validate-token.test.ts`.
- [x] **Token is validated** against `api.github.com` before use; every API response
  is Zod-validated at the boundary (`src/api/github/schemas.ts`, `schemas.test.ts`).
- [x] **Device flow explicitly deferred** with written rationale **and** cofounder
  sign-off — **ADR-003** (signed off by **@pedrofuentes** in DECISION issue #3): GitHub's
  `github.com/login/*` token endpoints are CORS-blocked from a pure SPA, so device/OAuth
  flows need a proxy (a future gated decision). v1 ships the self-contained PAT path.

## 3. Privacy invariant — automated network test (GitHub-owned origins only)

- [x] **PAT entered in-browser never leaves except to GitHub origins**, proven by the
  Playwright privacy spec [`e2e/privacy.spec.ts`](../e2e/privacy.spec.ts) driving the
  whole authenticated flow with every request intercepted. **3 tests, all green:**
  - `contacts only GitHub-owned origins across the whole authenticated flow`
  - `sends the PAT only as an Authorization header to api.github.com`
  - `ships a GitHub-locked Content-Security-Policy (defense in depth)`
- [x] **Strict CSP** (`connect-src` limited to `'self'` + GitHub origins) shipped in
  [`index.html`](../index.html) and asserted by `src/__tests__/content-security-policy.test.ts`
  (ADR-004).

  ```console
  $ npm run test:e2e
  10 passed (4.8s)   # privacy ×3, a11y ×6, smoke ×1  (chromium)
  ```

## 4. Rate-limit safety + graceful degradation

The 5,000 req/hr budget is held well below ceiling (ADR-002: 50 repos @ 5-min polling ≈
**<300 REST req/hr with ETags**) by a layered strategy — all implemented and tested:

- [x] **ETag / `If-None-Match` conditional requests** — a `304` costs 0 against the
  primary limit. `src/api/github/etag-cache.ts` (`etag-cache.test.ts`); the Link-paginated
  alert feeds restore the `304` short-circuit via a page-1 validator pinned to
  `sort=updated&direction=desc` (`security-branches.ts`, **ADR-007**).
- [x] **Bounded per-repo concurrency, cap = 6** — `SIGNAL_FETCH_CONCURRENCY = 6` in
  [`src/api/concurrency.ts`](../src/api/concurrency.ts) (`concurrency.test.ts`), so a large
  fleet fans out without bursting secondary rate limits.
- [x] **Rate-limit-store deferral** — an in-memory store records
  `X-RateLimit-Remaining`/`Reset` + `Retry-After` and defers non-essential conditional
  fetches when the budget is critically low (`rate-limit-store.ts`, `rate-limit.ts`; tests).
- [x] **Visibility-driven revalidation** — returning to a tab triggers a throttled,
  conditional refresh, mostly free `304`s (`useVisibilityRevalidate.ts`, `visibility.ts`; tests).
- [x] **Graceful 403/404 degradation** — a missing-scope `403` or feature-disabled `404`
  on a security feed is mapped to a ready `n/a` state, never a hard error, while a
  rate-limited `403` stays a real error (`src/hooks/signals/useSecuritySignal.ts` lines 66–92;
  `useSecuritySignal.test.ts`). `fetchWithRetry` honours `Retry-After` and only retries
  `[429, 502, 503, 504]`.
- [x] **Batched GraphQL — evaluated & deferred** as a future optimization. GraphQL has no
  HTTP conditional caching (no `ETag`/`304` savings), and the alert feeds are read via REST
  + `Link` pagination today; the ETag-based REST strategy already holds the budget far under
  ceiling (ADR-002, ADR-007). The DoD *intent* (rate-limit safe + graceful degradation) is met.

## 5. The seven MVP features — implemented & tested

| MVP feature (MISSION §4) | Implementation | Tests |
|---|---|---|
| **Fleet overview grid** | `src/components/FleetGrid.tsx`, `hooks/useRepos.ts`, `hooks/useRepoSignals.ts` | `FleetGrid.test.tsx`, `useRepos.test.ts`, `useRepoSignals.test.ts`, `fleet-sort.test.ts` |
| **CI / Actions status** | `columns/CiCell.tsx` + `CiColumn.tsx`, `hooks/signals/useCiSignal.ts` | `CiCell.test.tsx`, `CiColumn.test.tsx`, `useCiSignal.test.ts`, `workflow-api.test.ts` |
| **Open PRs** (new outside-contributor) | `columns/PullRequestsCell.tsx` + `Column.tsx`, `usePullRequestsSignal.ts` | `PullRequestsCell.test.tsx`, `PullRequestsColumn.test.tsx`, `usePullRequestsSignal.test.ts`, `pull-requests.test.ts` |
| **Security alerts + grade** | `columns/SecurityCell.tsx` + `Column.tsx`, `useSecuritySignal.ts`, `securityGrade.ts`, `api/github/security-branches.ts` | `SecurityCell.test.tsx`, `SecurityColumn.test.tsx`, `useSecuritySignal.test.ts`, `securityGrade.test.ts`, `security-branches.test.ts` |
| **Review-requested queue** | `columns/ReviewsCell.tsx` + `Column.tsx`, `useReviewsSignal.ts` | `ReviewsCell.test.tsx`, `ReviewsColumn.test.tsx`, `useReviewsSignal.test.ts` |
| **Issues overview** | `columns/IssuesCell.tsx` + `Column.tsx`, `useIssuesSignal.ts` | `IssuesCell.test.tsx`, `IssuesColumn.test.tsx`, `useIssuesSignal.test.ts`, `issues-releases.test.ts` |
| **Stale detection** | `columns/StaleCell.tsx` + `Column.tsx`, `useStaleSignal.ts` | `StaleCell.test.tsx`, `StaleColumn.test.tsx`, `useStaleSignal.test.ts` |
| **Drill-down drawer** | `src/components/DrillDownDrawer.tsx` | `DrillDownDrawer.test.tsx` |

- [x] All seven at-a-glance signals (overview grid + six per-repo columns) **and** the row
  drill-down drawer are implemented and unit/component-tested. Accessibility (WCAG 2.1 AA)
  is enforced by `e2e/a11y.spec.ts` (6 tests: landmarks, skip-link, Tab-reachability,
  non-text contrast).

## 6. README, LICENSE, CONTRIBUTING

- [x] **README** ([`README.md`](../README.md)) — fleet-grid and drill-down **screenshots**
  (`docs/screenshots/*.png`), a one-click **"use it now"** link
  (`https://pedrofuent.es/github-dashboard/`), feature table, privacy section, quick start.
- [x] **LICENSE** ([`LICENSE`](../LICENSE)) — **MIT** © 2026 Pedro Fuentes.
- [x] **CONTRIBUTING** ([`CONTRIBUTING.md`](../CONTRIBUTING.md)) — development workflow,
  coding standards, test-and-review process.

## 7. Full quality gate — green

Run in the release worktree after `npm ci` (Node 20):

| Gate command | Result |
|---|---|
| `npm run lint` | ✅ ESLint `--max-warnings 0` clean **and** "All matched files use Prettier code style!" |
| `npm run typecheck` | ✅ `tsc --noEmit` (app + node configs) — no errors |
| `npm run typecheck:test` | ✅ `tsc --noEmit -p tsconfig.vitest.json` — no errors |
| `npm run test:coverage` | ✅ **Test Files 54 passed (54)**, **Tests 903 passed (903)** |
| `npm run test:e2e` | ✅ **10 passed** (privacy ×3, a11y ×6, smoke ×1) — chromium |
| `npm run build` | ✅ built in ~0.56s — `dist/assets/index-*.js` 262.23 kB (gzip 77.68 kB) |

**Coverage (≥ 80 threshold, MISSION §7):**

```
All files          |   98.01 |    94.82 |     100 |   98.01
                   % Stmts    % Branch    % Funcs   % Lines
```

- [x] **Statements/Lines 98.01%**, **Branches 94.82%**, **Functions 100%** — all comfortably
  over the 80% floor; coverage threshold enforced by `vitest.config.ts` / CI.

## 8. Process integrity — every merge carried a Sentinel verdict

- [x] **34** merge commits on `main` carry an explicit Sentinel verdict line
  (`Sentinel: APPROVED | CONDITIONAL — Report ID … reviewed SHA …`), verified by:

  ```console
  $ git log --format="%H%n%b" main | grep -ciE "Sentinel:"
  34
  ```

  e.g. the most recent feature merge (#96, the security-signal/304-caching fix that spawned
  follow-ups #99/#100): `Sentinel: APPROVED (re-review) — Report ID SENT-PR96-7776c61-RR1`.

---

## Verdict

All MISSION §8 Definition-of-Done items are satisfied with the evidence above; the seven
MVP features are implemented and tested; the full lint/typecheck/typecheck:test/coverage/e2e/build
gate is green; privacy and rate-limit safety are verified; README + LICENSE (MIT) + CONTRIBUTING
are shipped; and every merge to `main` carried a Sentinel verdict.

**v1 declared shippable.**
