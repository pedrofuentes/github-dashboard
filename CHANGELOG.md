# Changelog — github-dashboard

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-06-19

### Added

- Initial application scaffold — Vite + React 18 + TypeScript (strict), Tailwind
  CSS, with Vitest (unit) and Playwright (e2e) test runners (#5).
- GitHub REST data layer: every response is Zod-validated at the boundary,
  cache-backed requests are conditional (`If-None-Match`) — the Link-paginated
  alert feeds (e.g. code-scanning) fetch directly so they can read pagination
  headers — and per-repo fetches run under a bounded concurrency cap so a large
  fleet fans out without exhausting the rate-limit budget (#60, #64).
- PAT sign-in with in-browser token storage — in-memory by default, opt-in
  `sessionStorage`/`localStorage` persistence, and a one-click "Forget token"
  (#10).
- Fleet overview grid — a sortable, filterable semantic table of every repo with
  per-cell loading skeletons (#11).
- Six per-repo signal columns, each sortable and encoding state with icon **and**
  text (never colour alone):
  - CI/Actions status with a failing-run count (#12).
  - Security alerts (Dependabot + code-scanning) summarised as a letter grade
    (#14).
  - Review-requested queue — open PRs awaiting your review (#15).
  - Open pull requests with new outside-contributor highlighting (#13).
  - Issues overview with an over-threshold indicator (#16).
  - Stale PR/issue detection (#17).
- Row drill-down drawer with per-signal sections (CI, Security, PRs, Issues,
  Stale) for at-a-glance triage (#18).
- Bounded in-memory LRU for the ETag/response cache (size cap with oldest-entry
  eviction) so long sessions can't grow the cache unbounded (#47).
- Live rate-limit awareness: a small in-memory store records the latest
  `X-RateLimit-Remaining`/`X-RateLimit-Reset` and `Retry-After` from responses,
  exposes the current status, and defensively defers non-essential conditional
  fetches while the primary budget is critically low or a secondary-rate-limit
  pause is in effect (#47).
- Visibility-driven revalidation: returning to a tab triggers a throttled,
  conditional (`If-None-Match`) refresh of per-repo signals — refreshing
  background-stale data with mostly-free `304`s (#47).
- Security grade "partial" indicator — when a repository has more open security
  alerts than the per-feed pagination cap can enumerate, the Security column now
  surfaces a **lower-bound** grade instead of silently undercounting: the
  severity summary is prefixed with `≥` and tagged "partial", and the cell's
  accessible label reads "at least … (partial — more alerts not counted)". The
  grade is derived from the alerts counted so far, so a truncated tally can only
  understate risk, never hide it; partial reads are also never cached as an
  unchanged `304` (#77).

### Changed

- Security signal hardened: both the Dependabot and code-scanning alert feeds
  are paginated beyond the first 100 results, fetches honour an explicit
  per-(repo, feed) concurrency cap (no hidden 2× fan-out), the column falls back
  to a ready `n/a` state when neither feed is accessible, and the populated
  render path is guarded against partial data (#63, #65, #71).
- Review-requested queue paginates the cross-repo search so reviewers with more
  than one page (>100) of requests are no longer undercounted (#62).
- Accessibility & contrast pass on the app shell and fleet grid: a
  skip-to-main-content link, a labelled `<main>` landmark, a `role="search"`
  filter, polite `aria-live` status text, `scope`-d table headers exposing
  `aria-sort`, visible focus outlines on every control, and a higher-contrast
  re-theme — meeting WCAG 2.1 AA. Also honours `prefers-reduced-motion` (#20,
  #21).

### Fixed

- Removed the inert `frame-ancestors 'none'` directive from the app shell's
  `<meta>` Content-Security-Policy. Browsers ignore `frame-ancestors` delivered
  via a `<meta>` element — it has effect only as an HTTP response header, which
  GitHub Pages (static hosting) cannot send — so it provided no clickjacking
  protection and logged an error-level message in the console on every load.
  Dropping it clears the only console error on the live site without weakening
  any other directive; header-delivered frame protection remains tracked as a
  hosting-layer follow-up (#104).
- Abort-aware retry backoff: cancelling a request during the retry backoff now
  aborts promptly instead of waiting out the full delay, and never issues an
  extra network request; genuine timeouts remain retryable (#70).
- Restored the `AuthProvider` unmount guard so an in-flight mount effect can no
  longer erase a freshly entered token (#43).

### Removed
