# Changelog — github-dashboard

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security

- **Toolchain security upgrade**: bumped the dev/test/build toolchain to Vite
  `^6.4.3` and Vitest `^3.2.6` (with `@vitest/coverage-v8` `^3.2.6` and
  `@vitejs/plugin-react` `^4.7.0`), clearing the outstanding dev-only Dependabot
  / `npm audit` advisories (the Vitest UI critical, the Vite `fs.deny`
  path-traversal high/moderate, and the esbuild dev-server moderate). These are
  build/test-time dependencies only — none ship in the static Pages bundle — and
  `npm audit` now reports 0 vulnerabilities (#29).

### Added

- **Deck view** — a Stream Deck–style board showing one key per repository ×
  signal (CI, security, reviews, pull requests, issues, stale). Reachable from
  the view switcher, the `g d` keyboard shortcut, and selectable as the default
  view (#500).
- **Show/hide repo owner** — a Settings → Appearance toggle (and a ⌘K "Toggle
  repo owner" command) that hides the `owner/` prefix in repository labels
  across the matrix, tiles, inbox, and drill-down, while keeping the full
  `owner/name` in tooltips and links (#488).
- **Community-vs-mine open issues**: when you're signed in, the Issues cell (in
  the Matrix and Triage) and the Issues tile now break the open-issue total down
  into how many were opened by the community versus by you — shown as a compact
  `· N community · N mine` annotation on the cell and an `N community · N mine`
  meta line on the tile, with the full split spelled out for screen readers. The
  total count and the over-triage-threshold warning are unchanged, and signed-out
  views render exactly as before.
- **Inbox multi-select + bulk-action bar**: triage many notifications at once
  instead of clicking one by one. Each Inbox row now has a selection checkbox;
  selecting one or more reveals an accessible bulk-action toolbar that shows the
  selection count and lets you **Mark read**, **Dismiss**, or **Restore** the
  whole batch (Restore enables only when a dismissed item is selected), plus
  **Select all** visible and **Clear selection**. Each batch is one persisted
  triage update, the action is announced for screen readers, and the selection is
  pruned to currently-visible items so a bulk action never touches a hidden one.
- **Keyboard shortcuts + "?" help overlay**: power-user navigation lands in the
  authenticated app. Press `g` then `t`/`m`/`g`/`b`/`i` to jump to
  Triage/Matrix/Grid/Boards/Inbox, `?` to open a discoverable shortcuts cheat
  sheet, and `,` to open Settings. Shortcuts never fire while you are typing in a
  filter/search field, and ⌘K (command palette) and browser chords pass through
  untouched. The help overlay is a fully accessible dialog (focus trap, `Esc` /
  backdrop close, focus restore) and also points to ⌘K and Saved Views.
- **⌘K command palette (live)**: press ⌘K (or Ctrl-K) anywhere in the
  authenticated app to open a searchable command palette. It exposes navigation
  (Go to Triage/Matrix/Grid/Inbox/Boards), filter presets (Needs attention,
  Awaiting my review, Failing CI, Security risk, Stale, Clear all filters),
  Open Settings, and Toggle theme/density — each wired to existing actions
  (no new behaviour). Recently-run commands are remembered and surfaced first.
- **Saved Views manager + quick-switcher**: a new accessible `SavedViewsMenu`
  disclosure (backed by the `useSavedViews` hook) lets you save the current repo
  filter + target view as a named workspace and apply, rename, or delete saved
  views. Names are validated (non-empty, bounded length) before persisting, with
  inline feedback.
- **Saved Views in the toolbar + built-in presets**: the Saved Views menu is now
  mounted in the app toolbar for every view, wired to the live filter and target
  view, so you can save the current scope and apply, rename, or delete views from
  anywhere. It also ships six read-only starter **presets** (Needs attention,
  Awaiting my review, Failing CI, Security risk, Stale, All repositories) — each
  applies a sensible filter + view in one click, making the menu useful out of
  the box.
- **Global repo scope across all views**: the faceted repo filter is now a
  single global scope (ADR-027). Activating it narrows **every** primary view —
  including the Grid table and the Notifications Inbox, which previously ignored
  it — and the filter control is now available on those views too, matching the
  existing Matrix/Triage placement. The Inbox's per-device triage and fleet-wide
  unread badge are unchanged (scope narrows what's shown, not what's stored), and
  the Boards filter-gating (ADR-025) is untouched.
- **Rule-based dashboard customization**: the **Customize dashboard** panel now
  shapes the board with signal *rules* instead of a per-repo checkbox grind.
  Seven tri-state signal toggles each show or hide that signal across **every**
  repository at once (with a live "shown of total" status), backed by bulk
  **Show all tiles**, **Hide all tiles**, and **Show only selected** actions. A
  repository search still surfaces targeted per-repo tile overrides and display
  aliases for power users, and **Reset to default layout** plus the dialog's
  focus-trap/`Esc`/return-focus accessibility are unchanged.
- **Settings overlay**: the previously scattered preference controls — the
  header **Theme** and **Density** toggles, the toolbar **Default view** control,
  and the authenticated-as / **Forget token** account bar — are now consolidated
  behind a single header **Settings** button that opens one accessible modal
  dialog (focus-trapped, `Esc`/backdrop to close, focus returns to the opener).
  The dialog groups them into **Appearance**, **Defaults** and **Account**
  sections; all controls keep their existing behaviour.
- **Triage home** (ADR-030): the **Triage** view — the attention-first "what needs me right now?" surface — is now the out-of-the-box default landing view, grouping the fleet worst-first into urgency bands (Needs attention → Waiting on me → Community → Watch → Healthy). It honours the **faceted repo filter** and drills down into the existing detail drawer, and is listed first in both the view switcher and the **Default view** control. The **Fleet Matrix** remains a prominent selectable view and a valid persisted default; existing users keep whatever default they previously chose.
- **Fleet Matrix view** (ADR-026): a dense, scannable **repos × signals** table is now the out-of-the-box default landing view, replacing the free-form tile grid as the at-a-glance surface. Repositories are ordered worst-first into collapsible **Broken / Warning / Healthy** health groups (Healthy collapsed by default), every cell reuses the same status vocabulary as the Grid, and each row drills down into the existing detail drawer. The Matrix honours the **faceted repo filter** and the **density** control, and is available alongside Grid / Dashboard / Inbox in both the view switcher and the **Default view** control. Existing users keep whatever default they previously chose.
- **Dashboard customization & repo-scope filter** (Phase 3): a **Customize layout** panel to show or hide tiles per repository and set short per-repo **display aliases** (the real `owner/name` is still announced to assistive tech), plus a toolbar **repo filter** to focus the Dashboard on just the repositories you pick. While a filter is active the grid is read-only — drag, resize and keyboard rearrange are paused — so a focused, partial view can never be compacted and saved over your real tile arrangement. Empty states are now actionable: distinct messages for no repositories, **all tiles hidden** (with a nudge to add some back), and **nothing matching the current filter** (with a one-click **Clear filter**). All client-only and stored per-device. When the filter narrows the grid to a **single repository**, each tile's now-redundant `owner/name` header line is visually dropped — still announced to assistive tech — so the focused view reads as one clean board.
- **Configurable default view**: the **Dashboard** is now the out-of-the-box default landing view, and a new **Default view** control lets you choose which of **Grid / Dashboard / Inbox** the app opens to (persisted under `fleet:default-view`). The app no longer reopens to your last-used view — it always opens to your chosen default.
- **Notifications Inbox** (M11): a third top-level view — a single, **newest-first**,
  triageable list that gathers everything across your fleet that needs attention
  into one queue. It aggregates **five actionable signals** — failing CI runs,
  pull requests awaiting **your** review, new outside-contributor PRs, new security
  alerts, and stale PRs/issues — as discrete, recency-ordered items, so a red build
  on one repo and a first-time-contributor PR on another are no longer buried in
  per-repo cells. Full **per-device triage** rides on top: mark items read (open one
  or "mark all"), **dismiss** / restore, a **"new since last visit"** highlight, and
  an **unread badge** on the **Grid / Dashboard / Inbox** view toggle. **Filters**
  (by repo, by kind, unread-only, show-dismissed) compose client-side, and the view
  meets WCAG 2.1 AA in both themes (meaning never by colour alone, keyboard-operable
  rows and dismiss controls, links gated to `github.com`). Crucially it is a **pure
  transform of data the app already fetches** — it adds **no new GitHub token
  permission, no new API request or datasource, and never writes back to GitHub** —
  and triage is stored per-device in `localStorage` (`fleet:inbox-triage`,
  Zod-validated, capped and pruned). See ADR-017, ADR-018, ADR-019.
- **Dark theme + Light / Dark / System toggle** (dark-theme milestone): the whole
  app can now render in a GitHub-dark palette as well as the original light one.
  A segmented **Theme** control (`role="radiogroup"`, top-right of the header) lets
  you pick **Light**, **Dark**, or **System** — each option carries a redundant
  icon **and** text label (never colour alone) and meets WCAG 2.1 AA in both
  themes. The choice persists to `localStorage['fleet:theme']` (default
  `system`), and **System** follows your OS `prefers-color-scheme` live. Theming
  is driven by Tailwind `darkMode: 'class'` plus CSS-variable-backed **semantic
  tokens** (`bg` / `surface` / `text` / `border` / `accent-*`), so a single
  `.dark` class flip on `<html>` recolours the entire tree — including the SVG
  tile visuals. The persisted theme is applied **before first paint** from the
  bundle entry (`main.tsx`), avoiding a flash of the wrong theme (FOUC) without
  an inline script (the app's `<meta>` CSP is `script-src 'self'`). See
  ADR-013, ADR-014.
- **Redesigned, Stream-Deck-informed dashboard tiles** (tile-redesign milestone):
  each (repo, signal) dashboard tile now uses its larger, resizable canvas for a
  bespoke, glanceable visual instead of a table cell floating in white space. A
  shared **`TileFrame`** (accent bar → header → body → footer, plus the existing
  grid a11y/edit machinery) wraps a per-signal body built from a new
  size-responsive primitive library (`StatusGlyph`, `BigValue`, `Chip`,
  `SeverityBar`, `ArcGauge`, `Sparkline`, `Heatmap`, `AmbientGlow`, …):
  - **CI / Actions** — a large status glyph with an ambient status **glow**, the
    status word, and the failing-workflow count.
  - **Security** — an **arc gauge** with the letter **grade** as its hero plus a
    per-**severity** breakdown bar (the partial/`≥` indicator is preserved).
  - **Pull requests** — the open-PR count with a prominent **new-contributor
    highlight** chip when outside contributors have open PRs.
  - **Reviews / Issues** — urgency-scaled counts (the accent escalates with the
    backlog) with the triage wording spelled out.
  - **Stale** — **age-led**: the hero is the oldest item's age (e.g. "34d") over
    an **age-bucket bar** (`>14d` / `>30d` / `>60d`), with the count and PR/issue
    split demoted to a secondary line — so staleness reads by how old, not how
    many.
  - **Fleet summary** — the pinned anchor is reworked into a **health-split bar**
    (need-attention / warning / healthy proportions) above the per-signal rollup
    chips, each segment keeping its icon + count + word. See ADR-015.
- **Activity dashboard tile** (the 7th grid tile): a new per-repo tile that
  visualises recent commit cadence — a commit **sparkline** of weekly totals with
  the total as a hero number, expanding to a weeks × 7-day contribution
  **heatmap** at larger sizes. It is **self-fetching** and lazy: it reads weekly
  commit activity via `useCommitActivity` only for the single repo it is mounted
  with (not wired into the fleet poll), with redundant encoding throughout (an
  sr-only weekly-totals table, per-cell counts, a stated total) and
  meaning-bearing loading / computing / empty / error fallbacks. See ADR-016.
- **Dashboard loading & error states**: the Dashboard view now mirrors the Grid
  view's lifecycle handling — a reduced-motion-friendly **skeleton** of
  placeholder tiles while your repositories load (instead of briefly flashing the
  "No repositories to display." empty state), and an **error alert with a Retry
  button** when the fetch fails (instead of stranding you on the empty state).
  The states are threaded from the authenticated fleet panel and announced for
  assistive tech (#120).
- **Dashboard view screenshot** (M10 finalization): the README's _Dashboard
  view_ section now shows a real capture of the at-a-glance Dashboard — the
  pinned fleet summary above the glanceable per-(repo, signal) tiles — rendered
  against a mocked, entirely fictional fleet by a deterministic Playwright
  capture spec (`e2e/dashboard-screenshot.spec.ts`). No real repository or token
  is involved (#138).
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
- Dashboard **edit mode** (M10 T3, #111): a **Customize layout** toggle (shown
  only in the dashboard view) enables react-grid-layout pointer **drag + resize**
  to rearrange and size tiles, persisted across sessions. Resize handles stay
  visible while editing with a slate-600 glyph that meets WCAG 1.4.11 non-text
  contrast, and users who prefer reduced motion get instant top/left positioning
  instead of the CSS-transform animation. Keyboard-accessible reorder/resize
  (the WCAG 2.1 AA gate) was completed in M10 T4 — see the entry above.
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

- **Triage rows now surface every pending action for a repo**: a repository is
  grouped into its single highest-priority band (e.g. **Needs attention** for an
  over-threshold issue backlog), but its row now renders **all** of its active
  signal indicators — failing CI, security, issues, pending reviews, new
  external PRs, and stale items — in a consistent order, instead of only the
  band's own signal. Previously a repo in "Needs attention" (for example one
  with 727 open issues) hid its pending-review / external-PR / stale badges, so
  those actions were invisible until you drilled in (T-c1).
- **Density toggle now updates the dashboard live**: switching density to
  **Glanceable** (or back to Balanced) in Settings — or via the ⌘K "Toggle
  density" command — immediately re-renders the Fleet Matrix and dashboard tiles
  instead of doing nothing until a reload. `useDensity` was a per-component
  `useState`, so each of its four consumers held an independent copy; the toggle
  only updated its own and the matrix/tiles never heard about the change. It is
  now a single shared `useSyncExternalStore` reading `localStorage` as the source
  of truth, so every consumer re-renders in sync (T-fix-density-sync).
- **Keyboard focus stays visible in the ⌘K palette and repo filter**: both
  `aria-activedescendant` listboxes now scroll the highlighted option into view
  as you arrow/Home/End through long lists, so the active descendant — the only
  visible keyboard-focus indicator — never disappears off-screen (WCAG 2.1 AA
  2.4.7 Focus Visible, #468/#469).
- **Tinted-badge label contrast (light theme)**: the **warning** and **coral**
  badge/chip text now uses darker **amber-800 (`#92400e`)** / **orange-800
  (`#9a3412`)** ink instead of the amber-700 / orange-700 accent, so small labels
  on a 10% accent tint clear WCAG 2.1 AA 4.5:1 (the -700 accents only reached
  ~4.4:1); borders and rings keep the -700 accent (non-text UI, ≥3:1). Surfaced
  while building the dark theme's per-theme token system (#171).
- **Dashboard tile focus no longer throws on exotic ids**: restoring roving focus
  to a tile interpolated the tile id (`owner/repo:signal`) straight into a
  `querySelector`, so a repository name containing a CSS-selector metacharacter
  (e.g. a quote) raised a `DOMException`. The lookup now wraps the id with
  `CSS.escape` (#131).
- **Dashboard layout no longer snaps back or loses a last-second drag** (M10
  finalization): when the fleet finished loading within the 300 ms persistence
  debounce window right after a drag, the layout reconcile read `localStorage`
  before the pending write landed and clobbered the just-dragged arrangement —
  the hook now flushes the pending write before reconciling, so the drag is
  committed and survives (#126). A hard page close/navigate (or backgrounding the
  tab) within the same window also dropped the last change, because the React
  unmount-flush never runs on a real page unload — the hook now flushes on
  `beforeunload` and on `visibilitychange → hidden` as well (#127).
- **Dashboard keyboard-grid a11y refinements** (M10 finalization): an arrow key
  pressed on a tile at a grid boundary now calls `preventDefault()` even when
  focus can't move, so the page no longer native-scrolls under the grid (#130).
  Each tile also carries an accurate `aria-rowindex`/`aria-colindex` derived from
  its grid geometry (and the grid exposes `aria-rowcount`/`aria-colcount`), so a
  tile visually in column 2 is announced "column 2" instead of always "column 1"
  (WCAG 2.1 SC 1.3.1) (#130, #132).

### Changed

- **Dashboard view renamed to "Boards" and demoted**: the free-form,
  drag-and-drop react-grid-layout view is now labelled **Boards** in the view
  switcher and the **Default view** control, and sits **after Matrix and Grid**
  as a secondary, optional surface (the **Fleet Matrix** remains the scannable
  default per ADR-026). The view keeps all of its existing behaviour — tiles,
  drag/resize, keyboard rearrange and the customize flow are unchanged; only the
  label and ordering moved. Existing saved defaults are unaffected.
- **Forward-compatible Boards layout storage**: the persisted tile layout now
  uses a **versioned envelope** (`{ version: 2, tiles }`) under the new
  `fleet:dashboard-view:v2` key. An existing unversioned layout under the legacy
  `fleet:dashboard-layout` key is **migrated automatically on first load** (your
  tiles and positions are preserved exactly) and the legacy key is **kept for
  rollback**. Corrupt or missing storage degrades to the default layout as
  before. This is a storage-format change only — nothing changes on screen.


  reworked around a **3-tier salience model** so a glance reads problems first.
  Only tiles that need action carry colour — a PROBLEM tile (e.g. failing CI, a
  D–F security grade) and the "needs-you" Reviews tile — while healthy tiles stay
  **calm**, with their identity moved into the header icon rather than a coloured
  fill. A **thicker top accent bar** (5px, growing to 6px on problems) reinforces
  the hierarchy. Each signal now has a purpose-built body:
  - **CI / Actions** — an honest failing hero with the most-recent run cell.
  - **Security** — a severity-led hero over a **stacked severity bar** (replacing
    the old arc gauge).
  - **Pull requests** — the new-contributor highlight plus the oldest external
    PR's age.
  - **Reviews** — what's awaiting **you** plus the oldest waiting age.
  - **Issues** — open count plus stale count.
  - **Stale** — an age-led hero over an age-bucket bar.
  - **Activity** — commits/week with a delta (in purple).
  - **Fleet summary** — inflames on any failure, with a per-repo worst-state strip
    and a ranked footer.
  A new **density preference** lets you toggle the standard tiles between
  **Balanced** (default) and **Glanceable**, reshaping how much each tile shows. A
  unified **states matrix** makes loading, "All clear", and "Couldn't load"
  visually distinct, the micro-visualisations stay legible in **grayscale**, and
  every tile meets **WCAG 2.1 AA in both light and dark themes** via per-theme
  tokens. Where the API doesn't yet carry the data the design imagines (CI
  run-history, Activity's merged-PRs→commits, an Issues delta, PR drafts, and a
  few states) the tiles fall back honestly rather than showing invented numbers —
  those are deferred, not faked (#194).
- **Dashboard tiles now render bespoke per-signal bodies** instead of reusing the
  compact `*Cell` table atoms. `SignalTile` stops embedding the table cells and
  instead composes `TileFrame` + a signal-specific body from the new `tiles/*`
  primitive library, so a resizable tile fills its canvas with a purpose-built
  visual. The table (Grid) view is unchanged — it keeps the `*Cell` atoms — and
  the grading/scoring and URL-safety helpers are reused, not duplicated. The
  tile `data-status`, roving-tabindex, `aria-colindex`/`aria-rowindex`,
  activate-overlay, and keyboard Move/Resize behaviour are all preserved. See
  ADR-015.
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
