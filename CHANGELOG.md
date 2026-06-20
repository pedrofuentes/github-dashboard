# Changelog — github-dashboard

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Fleet summary tile** (M10 — the final increment): a pinned, glanceable
  anchor at the top of the Dashboard view that rolls the whole fleet up into one
  line — total repos and the **need attention / warning / healthy** split — plus
  the non-zero per-signal rollups (failing CI, security risk, awaiting your
  review, stale). A repo "needs attention" on any failing CI run, a D–F security
  grade, or an over-threshold issue backlog; it's a "warning" on a C security
  grade, a pending review request, or stale items. The card reuses the tile
  anatomy (icon **and** text, never colour alone, WCAG 2.1 AA) and — unlike the
  per-(repo, signal) tiles — is not draggable, resizable, or removable. The
  README gains a **Dashboard view** section documenting the Grid/Dashboard
  toggle, glanceable tiles, edit-mode drag/resize + keyboard reorder, and layout
  persistence (#113).
- **Keyboard-accessible reorder + resize** (M10 T4 — the WCAG 2.1 AA gate): the
  dashboard tile arrangement is now a `role="grid"` with **roving-tabindex arrow
  navigation** (a single tab stop; ←/→/↑/↓ move focus between tiles by their grid
  position). In edit mode each tile exposes a **Move/Resize** control group — the
  keyboard equivalent of T3's pointer drag — that nudges the tile one grid cell or
  grows/shrinks it one unit, clamped to the 12-column grid and persisted
  (debounced) like a pointer edit. Each change is announced via an
  `aria-live="polite"` region (e.g. _"Moved CI · octo/a to column 4, row 1"_ /
  _"Resized CI · octo/a to 4 by 3"_), focus returns to the operated tile, and (as
  with pointer moves) keyboard moves don't animate under `prefers-reduced-motion`.
  Tile activation (Enter/Space → drill-down) is unchanged (#112).
- Dashboard **edit mode** (M10 T3): a **Customize layout** toggle (shown only in
  the dashboard view) enables react-grid-layout pointer **drag + resize** to
  rearrange and size tiles, persisted across sessions. Resize handles stay
  visible while editing with a slate-600 glyph that meets WCAG 1.4.11 non-text
  contrast, and users who prefer reduced motion get instant top/left positioning
  instead of the CSS-transform animation. Keyboard-accessible reorder/resize (the
  WCAG-AA gate) follows in a later M10 task — existing keyboard tile activation is
  unchanged (#111).
- At-a-glance **Dashboard view** (M10): a new tile arrangement that renders one
  card per (repo, signal) on react-grid-layout, reusing the existing per-signal
  cells (icon + colour + text, never colour alone) with per-status states
  (loading / error / unknown / ready) and a status accent. Each tile is
  keyboard-activatable and opens the same drill-down drawer as the grid. An
  accessible **Grid / Dashboard** view toggle (persisted in `localStorage` under
  `fleet:view`, defaulting to the table grid) switches between the two. This
  increment is read-only — drag, resize and edit mode arrive in later M10 tasks
  (#110). See ADR-011.
- Dashboard layout model + persistence (M10 foundation): a `DashboardTile` model,
  a default one-tile-per-(repo, signal) layout on a 12-column grid, a
  react-grid-layout mapping, and defensive `localStorage` persistence with
  validate-on-read and reconciliation against the current fleet (#109). Adds the
  pre-approved **react-grid-layout** dependency. See ADR-010.

### Fixed

- **Dashboard keyboard-grid a11y refinements** (M10 finalization): an arrow key
  pressed on a tile at a grid boundary now calls `preventDefault()` even when
  focus can't move, so the page no longer native-scrolls under the grid (#130).
  Each tile also carries an accurate `aria-rowindex`/`aria-colindex` derived from
  its grid geometry (and the grid exposes `aria-rowcount`/`aria-colcount`), so a
  tile visually in column 2 is announced "column 2" instead of always "column 1"
  (WCAG 2.1 SC 1.3.1) (#130, #132).

### Changed

- The **Customize layout** toggle's active state now uses `sky-700` instead of
  `sky-600` so white label text meets the WCAG 2.1 AA 4.5:1 contrast minimum
  (~5.93:1, up from ~4.1:1); its focus ring is bumped to `sky-700` to match
  (#125).
- `useDashboardLayout` now updates the in-memory layout immediately but
  **debounces** the `localStorage` write (~300 ms), so a react-grid-layout drag
  (which fires `onLayoutChange` many times per second) coalesces to a single
  persist and never janks the main thread; any pending write is flushed on
  unmount (#116).
- `DashboardView` resolves each repo's signal data once per render into a
  referentially stable map (instead of once per tile), removing redundant
  allocations and keeping tile `data` stable for memoisation (#121).
- `useDashboardLayout` now re-reconciles the persisted layout against the fleet
  when the set of repos changes after mount (e.g. repos that load asynchronously),
  using a stable fleet key so unrelated re-renders don't churn the layout (#115).
- Adopted **autonomous-kickoff template v2.1.0** (`docs/VERSION` → 2.1.0): upgraded the generic
  operating docs and enabled **attended single-operator mode** (`MISSION.md` §7
  `attended-single-operator: yes`) so the build runs now under the present operator without a
  separate identity (Tier-1 only). See ADR-009.
- Adopted the **autonomous-kickoff template v2.0.0** (`docs/VERSION` → 2.0.0): upgraded the
  generic operating docs and migrated `MISSION.md` to the tiered-authorization schema; added the
  **Blocked** / **Pending Decision** board statuses and a `security` label. Unattended runs now
  require a distinct agent identity (one-time setup). See ADR-008.

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
