# Dashboard Tile Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan — each Task below is one PR-sized increment with its own failing-test-first cycle, and Wave 1 tasks touch disjoint files so they can be dispatched to parallel implementers. Steps use checkbox (`- [ ]`) syntax; check each off only after the named command/output confirms it. Every increment is independently Sentinel-reviewed (see `AGENTS.md`), so do NOT batch unrelated tiles into one PR.

**Goal:** Refactor the existing `src/components/tiles/**` primitives + `bodies/*` into the "Signal Keys" calm-glanceable fleet console defined by `docs/superpowers/specs/2026-06-21-dashboard-tile-redesign-design.md` — a 3-tier salience model (PROBLEM / ACTIONABLE-TO-ME / CALM), severity-led Security, age-led Stale, a single coherent Activity hero metric, an inflaming ranked Fleet anchor, a user density preference (Balanced default ↔ Glanceable), the full missing-states matrix, alias display + a11y, and grayscale-survivable micro-viz — all WCAG 2.1 AA in both themes.

**Architecture:** Per-repo signal hooks (`src/hooks/signals/*`) → `useRepoSignals.getRowData(repo)` → `RepoSignalData` → `SignalTile` (`useTileSize` → `TileFrame` + `SignalBody` switch to `bodies/*TileBody`) → laid out by `DashboardView`. `FleetSummaryTile` is a pinned, non-grid anchor fed by `summarizeFleetHealth(repoData.values())`. The redesign keeps this data-flow and the primitive library; it adds a **salience layer** (a pure resolver + a `salience` prop on `TileFrame`), reworks each body's hero/meta/micro-viz, replaces `ArcGauge` in Security, and adds two client-side preference modules (density) mirroring `theme-preference.ts` / `view-preference.ts`. **No new GitHub token scopes and no new API requests** — every tile renders only data already present on its signal slice (see Global Constraints + per-task Data availability notes).

**Tech Stack:** TypeScript, React 18, Vite, Tailwind, Zod, Vitest, Testing-Library.

## Global Constraints

- **WCAG 2.1 AA in both themes** — every text/background pairing ≥4.5:1 (≥3:1 for ≥18px / non-text UI). New tokens MUST document computed ratios in BOTH `:root` (light) and `.dark` (dark). Focus-visible uses the existing sky ring.
- **No new token scopes / no new API requests** — tiles consume only fields already on `RepoSignalData` slices / `useCommitActivity`. Any spec value not already available is either (a) derived from existing data, or (b) explicitly flagged as a design-vs-data gap with a fallback. Never add a fetch.
- **Semantic tokens only — no inline status hex.** New colours are added once per theme as `--color-*` in `src/index.css` (`:root` + `.dark`) and mapped to a Tailwind `accent-*` utility in `tailwind.config.js`; components reference token names / `var(--color-*)` only (via `toneBgClass` / `toneTextClass` / `toneToVar`).
- **TDD failing-test-first** — every behaviour-bearing increment: `test(scope):` (suite FAILs referencing the missing symbol) → `feat|fix(scope):` (suite PASSes) → optional `refactor(scope):`. Token/config/type-only changes are TDD-exempt but still ship with a test where a helper has behaviour, and still pass the suite.
- **Conventional commits + Copilot co-author trailer** on every commit:
  ```
  type(scope): short description

  Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
  ```
- **Coverage ≥80% (ratchet — never decrease); lint-clean (`npm run lint`, zero warnings); zero 🔴.**
- **Refactor existing primitives, don't rewrite** — reuse `StatusGlyph`, `Sparkline`, `Heatmap`, `AccentBar`, `BigValue`, `Chip`, `SeverityBar`, `AmbientGlow`, `TileFrame`, `useTileSize`. Replace only `ArcGauge` usage in Security.
- **Commands:** targeted `npm test -- <path>` and `npm run lint` per increment; full `npm test` + `npm run lint` + `npm run typecheck` before each PR (Pre-Push Verification, `AGENTS.md`).

---

## Data availability findings (read before Wave 1)

Verified against `src/types/fleet.ts` + each `src/hooks/signals/*` + `useCommitActivity`. **IS available** = render directly. **GAP** = data not retained by the signal hook; fallback specified, no new fetch.

| Tile | Spec wants | Status | Fallback |
|---|---|---|---|
| CI | `N failing` glyph | IS (`ci.failingCount`, 0/1 — hook sets `failingCount: 1` on a failed latest run) | — |
| CI | `newest →` deep link · `2m` recency | IS (`ci.latestRunUrl`, `ci.updatedAt`) | — |
| CI | `▲2 since yest` delta · `9 passing` · 10-cell win/loss run strip | **GAP** (only the latest run is retained; no history, no passing count) | Drop the delta + passing count; replace the 10-cell strip with a single shape-coded latest-conclusion cell. Flag run-history as deferred (needs a windowed Actions fetch). |
| Security | worst severity hero · `11 total` · `2 critical · 5 high` · stacked severity bar | IS (`security.counts.{critical,high,medium,low}`) | — |
| Security | `1h` most-recent-alert recency | IS (`security.alerts[].created_at`, present when alerts>0) | When `alerts` absent (clean repo), omit recency. |
| Open PRs | `4` open · `1 new contributor` | IS (`pullRequests.openCount`, `externalCount`; new-contributor via `externalPullRequests[].author_association`) | — |
| Open PRs | `▲` new-contributor delta · `1 draft` · `oldest 6d` (all open) · review/new/draft segbar | **PARTIAL/GAP** (no history; drafts excluded from `openCount` and not counted; only `externalPullRequests` carry `created_at`) | Drop the delta and the draft count. Show **oldest external-contributor** PR age (from `externalPullRequests[].created_at`), labelled as external. Segbar = 2 segments (external vs other-open). Flag draft-count + overall-oldest as deferred. |
| Reviews | `2` awaiting you · `oldest 3d` | IS (`reviews.requestedCount`, `reviews.requests[].created_at`) | — |
| Issues | `7` open · `2 stale` | IS (`issues.openCount`; stale-issue count derived cross-slice from `data.stale.staleItems` filtered `type==='issue'`) | — |
| Issues | `▲3 new` delta · sparkline (detailed tier) | **GAP** (no issue history) | Drop the delta + sparkline. Flag as deferred (needs a counts time-series). |
| Stale | `34d` oldest (age-led) · `5 items (3 PR · 2 issue)` · age-bucket bar (>14/>30/>60d) | IS (`stale.staleItems[].updated_at` + `.type`, `stale.staleCount`) | — |
| Activity | `18` **merged PRs/wk** · `▲ vs last wk` · mini-heatmap | **GAP for "merged PRs"** (`useCommitActivity` returns weekly **commit** activity, not merged PRs; a merged-PR count needs a new Search request) | Hero = **commits this week** (`weeks.at(-1).total`) with `▲/▼ vs last wk` delta (both from existing `weeks`); keep the heatmap. Flag "merged PRs/week" as deferred (needs a new data source — violates no-new-request otherwise). This still kills the prior "↑18 … steady" contradiction (one coherent metric + delta). |
| Fleet | `12·3·1` health · health bar · ranked footer | IS (`summarizeFleetHealth` → `healthy`/`warning`/`broken` + rollups) | — |
| Fleet | per-repo worst-state strip (height-stepped) · worst-child chip · edge inflames red on any failing child | **NEEDS PLUMBING** (per-repo `classifyRepoHealth` exists but `FleetSummaryTile` only receives aggregate counts) | Add a pure `perRepoHealth(rows)` helper + pass `entries: {repo, health}[]` into `FleetSummaryTile`; derive worst-child + inflame from it. All data already in `repoData`. |
| All | full 7-state matrix (`not-configured`, `stale-cache`, `rate-limited`, Fleet `partial`) | **GAP** (`SignalStatus` is only `unknown\|loading\|ready\|error`) | Implement the states representable today (loading, empty-`0` "All clear", failed-to-load) as visually-unmistakable; implement `partial` where data exists (Security `truncated`, Fleet partial count). Flag `not-configured`/`stale-cache`/`rate-limited` as needing new `SignalStatus` metadata (deferred). |
| All | per-repo **alias** display | **GAP** (`Repo` has no `alias`; alias is a Phase-3 setting) | Add an optional `alias?` prop to `TileFrame`; render `alias ?? repo.nameWithOwner` + visually-hidden `(alias for owner/repo)`. No persistence/editor (Phase 3); prop defaults `undefined` so live behaviour is unchanged. |

**Fleet summary tile location:** `src/components/FleetSummaryTile.tsx` (NOT a `bodies/*` file, NOT in the react-grid-layout grid). Rendered by `src/components/DashboardView.tsx` (two call sites, ~L341 + ~L351), fed by `summary = useMemo(() => summarizeFleetHealth(repoData.values()), [repoData])` (~L139). Aggregation helpers live in `src/lib/fleet-summary.ts` (`classifyRepoHealth`, `summarizeFleetHealth`).

---

## File Structure

### Created
| File | Responsibility |
|---|---|
| `src/lib/tile-salience.ts` | Pure resolver `resolveSalience(signal, data) → TileSalience` (`tier` PROBLEM/ACTIONABLE/CALM + `edgeTone` + `tint`/`glow`/`actionableTab` flags). |
| `src/lib/tile-salience.test.ts` | Unit tests for every signal × state → salience. |
| `src/lib/density-preference.ts` | `Density` type + `load/saveDensityPreference` (localStorage, default `balanced`), mirroring `theme-preference.ts`. |
| `src/lib/density-preference.test.ts` | Default / round-trip / corrupt-storage tests. |
| `src/hooks/useDensity.ts` | React binding over `density-preference` (state + `setDensity`), mirroring `useTheme`. |
| `src/hooks/useDensity.test.ts` | Hook init / persist tests. |
| `src/components/DensityToggle.tsx` | Accessible 2-state `radiogroup` (Balanced / Glanceable), mirroring `ThemeToggle`. |
| `src/components/DensityToggle.test.tsx` | Render / select / a11y tests. |
| `src/components/tiles/TileMessage.tsx` | Shared presentational state row (loading / all-clear / failed-to-load / partial) with distinct glyph + `data-state`, used by every body. |
| `src/components/tiles/TileMessage.test.tsx` | Per-state glyph + `data-state` + sr-text tests. |
| `src/components/tiles/RunStrip.tsx` | (CI) single shape-coded latest-conclusion cell (grayscale-survivable; notch on fail). |
| `src/components/tiles/RunStrip.test.tsx` | Shape/notch + sr-label tests. |
| `src/components/tiles/AgeBucketBar.tsx` | (Stale) >14/>30/>60d bucket bar with height-stepped, grayscale-survivable segments. |
| `src/components/tiles/AgeBucketBar.test.tsx` | Bucketing + height-step + sr-list tests. |

### Modified
| File | Change |
|---|---|
| `src/index.css` | Add `--color-ochre` (Stale) to `:root` + `.dark`; document AA ratios. |
| `tailwind.config.js` | Map `accent-ochre: var(--color-ochre)`. |
| `src/components/tiles/types.ts` | Add `'ochre'` to `AccentTone` + `TONE_TEXT_CLASS`/`TONE_BG_CLASS`; add `SIGNAL_IDENTITY_TONE` map (header-icon identity tone per signal). |
| `src/components/tiles/types.test.ts` | Tone-mapping + identity-map tests. |
| `src/components/tiles/AccentBar.tsx` | Thickness → 5px (calm/standard) / 6px (problem) heights. |
| `src/components/tiles/AccentBar.test.tsx` | Height-class tests. |
| `src/components/tiles/TileFrame.tsx` | Accept `salience`, `alias`, `accessibleSummary`; drive bar thickness/tint/glow + ACTIONABLE edge tab; render alias + visually-hidden real repo; set activate-button `aria-label` to scope+metric+state. |
| `src/components/tiles/TileFrame.test.tsx` | Salience treatment, alias, aria-label tests. |
| `src/components/tiles/BigValue.tsx` | Optional `live?: boolean` → wrap value in `aria-live="polite"` region (hero count announcement). |
| `src/components/tiles/BigValue.test.tsx` | `aria-live` presence test. |
| `src/components/tiles/SeverityBar.tsx` | Optional height-step + inter-segment divider so segments survive grayscale. |
| `src/components/tiles/SeverityBar.test.tsx` | Redundant-channel tests. |
| `src/components/SignalTile.tsx` | Compute salience via `resolveSalience`; pass `salience` + `accessibleSummary` + `density` to frame/bodies; header identity tone from `SIGNAL_IDENTITY_TONE`. |
| `src/components/SignalTile.test.tsx` (create if absent) | Wiring tests. |
| `src/components/tiles/bodies/CiTileBody.tsx` | Hero failing-run + `RunStrip` + recency/newest; drop unavailable passing/delta. |
| `src/components/tiles/bodies/SecurityTileBody.tsx` | Remove `ArcGauge`; worst-severity hero + counts + recency + stacked `SeverityBar`. |
| `src/components/tiles/bodies/PrsTileBody.tsx` | Hero open + new-contributor + oldest-external age + 2-seg `SeverityBar`. |
| `src/components/tiles/bodies/ReviewsTileBody.tsx` | ACTIONABLE hero + oldest-request age. |
| `src/components/tiles/bodies/IssuesTileBody.tsx` | Hero open + cross-slice stale-issue meta. |
| `src/components/tiles/bodies/StaleTileBody.tsx` | Age-led hero (oldest) + type split + `AgeBucketBar` + ochre tone. |
| `src/components/tiles/bodies/ActivityTileBody.tsx` | Hero commits-this-week + delta vs last week + heatmap. |
| `src/components/FleetSummaryTile.tsx` | Accept per-repo `entries`; inflame edge, per-repo worst-state strip, worst-child chip, ranked footer. |
| `src/components/FleetSummaryTile.test.tsx` | New prop + treatment tests. |
| `src/lib/fleet-summary.ts` | Add `perRepoHealth(rows) → {repo, health}[]` helper. |
| `src/lib/fleet-summary.test.ts` | Helper tests. |
| `src/lib/format.ts` | Add `formatDelta(value) → ▲n/▼n/—`. |
| `src/lib/format.test.ts` | Delta tests. |
| `src/components/DashboardView.tsx` | Plumb `perRepoHealth(repoData)` into `FleetSummaryTile`; thread density. |
| `src/components/DashboardView.test.tsx` | Plumbing test. |
| `src/App.tsx` | Render `<DensityToggle />` beside `<ThemeToggle />`. |
| `src/App.test.tsx` (or existing) | Toggle-present test. |
| `DECISIONS.md` / `CHANGELOG.md` | Record token ratios + user-facing changes. |

---

## Tasks

> Ordering: **Wave 0** (foundations) must land before Wave 1. Within Wave 0, T1–T2 (tokens/AccentBar) and T3–T5 (resolver/format/density) are mutually independent → parallelizable. **Wave 1** tasks T6 (salience wiring) precedes the body tasks logically but touches different files, so T6 may run in parallel with T7–T14 (each body is a disjoint file). **Wave 2/3** depend on Wave 1.

---

### Wave 0 — Foundations

#### T1 — Ochre token for Stale (tokens + tone)
**Files:**
- Modify: `src/index.css`, `tailwind.config.js`, `src/components/tiles/types.ts`
- Test: `src/components/tiles/types.test.ts`

**Interfaces:**
- Produces: `AccentTone` gains `'ochre'`; `toneTextClass('ochre') → 'text-accent-ochre'`; `toneBgClass('ochre') → 'bg-accent-ochre'`; CSS var `--color-ochre`; Tailwind `accent-ochre`.
- Consumed by: T11 (Stale body), T3 (resolver edge tone for stale identity).

**Steps:**
- [ ] Add failing tests to `types.test.ts`: `toneTextClass('ochre')` returns `'text-accent-ochre'` and `toneBgClass('ochre')` returns `'bg-accent-ochre'`.
- [ ] Run `npm test -- src/components/tiles/types.test.ts` — confirm FAIL (TypeScript: `'ochre'` not assignable to `AccentTone`).
- [ ] In `types.ts`: add `'ochre'` to the `AccentTone` union and add `ochre` entries to `TONE_TEXT_CLASS` (`'text-accent-ochre'`) and `TONE_BG_CLASS` (`'bg-accent-ochre'`).
- [ ] In `tailwind.config.js`: add `'accent-ochre': 'var(--color-ochre)'`.
- [ ] In `src/index.css`: add `--color-ochre` to `:root` (light: `#7c5e10` — verify ≥4.5:1 on `--color-surface` `#ffffff`) and `.dark` (`#bfa05a` — verify ≥4.5:1 on `--color-surface` `#161b22`; the spec's `#8a6d3b` fails AA as text, so use a lighter ochre for ink and document the chosen value + ratio in a CSS comment).
- [ ] Run `npm test -- src/components/tiles/types.test.ts` — confirm PASS. Run `npm run lint`.
- [ ] Record the two chosen ochre hexes + computed ratios in `DECISIONS.md`.
- [ ] Commit `feat(tiles): add ochre accent token for stale tiles`.

**Data availability:** N/A (token only).

#### T2 — AccentBar 5px/6px salience heights
**Files:**
- Modify: `src/components/tiles/AccentBar.tsx`
- Test: `src/components/tiles/AccentBar.test.tsx`

**Interfaces:**
- Produces: `AccentBarProps.thickness?: 'calm' | 'problem'` (calm → `h-[5px]`, problem → `h-[6px]`); keep `'sm'`/`'md'` as deprecated aliases mapping to the same heights to avoid breaking current callers, OR migrate all callers in this task. Default stays calm-equivalent (5px).
- Consumed by: T6 (TileFrame salience).

**Steps:**
- [ ] Add failing tests: `<AccentBar tone="failure" thickness="problem" />` className contains `h-[6px]`; default / `thickness="calm"` contains `h-[5px]`; existing `data-tone` + `aria-hidden` assertions retained.
- [ ] Run `npm test -- src/components/tiles/AccentBar.test.tsx` — confirm FAIL.
- [ ] Update `AccentBar.tsx`: map thickness → `h-[5px]` (calm/default) / `h-[6px]` (problem); preserve `w-full rounded-t`, `aria-hidden`, `data-tone`, `toneBgClass`.
- [ ] Update any existing `thickness="sm"|"md"` callers found via `grep -rn "thickness=" src` to the new vocabulary (or keep aliases) — keep the suite green.
- [ ] Run targeted test — confirm PASS. Run `npm run lint`.
- [ ] Commit `feat(tiles): give AccentBar 5px calm / 6px problem heights`.

**Data availability:** N/A.

#### T3 — Salience resolver
**Files:**
- Create: `src/lib/tile-salience.ts`, `src/lib/tile-salience.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SalienceTier = 'problem' | 'actionable' | 'calm';
  export interface TileSalience {
    tier: SalienceTier;
    edgeTone: AccentTone;     // bar/edge colour (neutral for calm)
    tint: boolean;            // accent-tinted surface — problem only
    glow: boolean;            // soft glow — problem only
    actionableTab: boolean;   // info-blue persistent edge tab — actionable only
  }
  export function resolveSalience(signal: TileSignalType, data: RepoSignalData): TileSalience;
  ```
- Consumes: `RepoSignalData` (`src/types/fleet.ts`), `TileSignalType` (`src/types/dashboard.ts`), `AccentTone` (`tiles/types.ts`).
- Consumed by: T6 (SignalTile/TileFrame).

**Logic (from spec §3 + §5 per-tile salience column):**
- `ci`: `conclusion === 'failure'` → `{problem, failure, tint, glow}`; else `{calm, neutral}`.
- `security`: `counts.critical > 0` → `{problem, failure, tint, glow}`; `counts.high>0 || counts.medium>0` → `{problem, warning, tint, glow}`; else `{calm, neutral}`.
- `reviews`: `requestedCount > 0` → `{actionable, info, actionableTab}` (no tint/glow); else `{calm, neutral}`.
- `pullRequests`, `issues`, `stale`, `activity`: always `{calm, neutral}` (per §5; identity colour lives in the header icon, not the bar — §3 CALM). `stale`/`activity` identity tones (ochre/purple) are applied by the body + header icon, not the edge.
- Only `status === 'ready'` slices escalate; `loading`/`error`/`unknown`/absent → `{calm, neutral}`.

**Steps:**
- [ ] Write `tile-salience.test.ts` failing tests: CI failure → `{tier:'problem', edgeTone:'failure', tint:true, glow:true}`; CI success/none → calm/neutral; Security critical=1 → problem/failure; Security high-only → problem/warning; Security clean → calm/neutral; Reviews `requestedCount:2` → `{tier:'actionable', edgeTone:'info', actionableTab:true, tint:false, glow:false}`; Reviews 0 → calm; `pullRequests`/`issues`/`stale`/`activity` ready → calm/neutral; any `loading`/`error`/absent slice → calm/neutral.
- [ ] Run `npm test -- src/lib/tile-salience.test.ts` — confirm FAIL (module missing).
- [ ] Commit the failing test only: `test(tiles): add salience resolver tests`.
- [ ] Implement `tile-salience.ts` per the logic above.
- [ ] Run targeted test — confirm PASS. Run `npm run lint`.
- [ ] Commit `feat(tiles): add (signal,status,data)→salience resolver`.

**Data availability:** Uses only existing slice fields (`ci.conclusion`, `security.counts`, `reviews.requestedCount`). No new data.

#### T4 — `formatDelta` signed-delta formatter
**Files:**
- Modify: `src/lib/format.ts`, `src/lib/format.test.ts`

**Interfaces:**
- Produces: `export function formatDelta(value: number): string` — `▲n` for `>0`, `▼n` for `<0`, `'—'` for `0`/non-finite; magnitude via existing `formatCount` (so `1500 → '▲1.5k'`).
- Consumed by: T8 (PRs — not used in fallback), T12 (Activity), future deltas.

**Steps:**
- [ ] Add failing tests to `format.test.ts`: `formatDelta(3)==='▲3'`, `formatDelta(-2)==='▼2'`, `formatDelta(0)==='—'`, `formatDelta(1500)==='▲1.5k'`, `formatDelta(Number.NaN)==='—'`, `formatDelta(-2_500_000)==='▼2.5M'`.
- [ ] Run `npm test -- src/lib/format.test.ts` — confirm FAIL.
- [ ] Commit the failing test only: `test(format): add signed-delta formatter tests`.
- [ ] Implement `formatDelta` using `formatCount(Math.abs(value))`, guarding `!Number.isFinite(value) || value === 0`.
- [ ] Run targeted test — confirm PASS. Run `npm run lint`.
- [ ] Commit `feat(format): add signed-delta formatter (▲n/▼n/—)`.

**Data availability:** N/A (pure formatter).

#### T5 — Density preference module + hook + toggle
**Files:**
- Create: `src/lib/density-preference.ts`, `src/lib/density-preference.test.ts`, `src/hooks/useDensity.ts`, `src/hooks/useDensity.test.ts`, `src/components/DensityToggle.tsx`, `src/components/DensityToggle.test.tsx`
- Modify: `src/App.tsx` (render the toggle)

**Interfaces:**
- Produces:
  ```ts
  // density-preference.ts
  export type Density = 'balanced' | 'glanceable';
  export function loadDensityPreference(): Density; // default 'balanced'
  export function saveDensityPreference(density: Density): void;
  // useDensity.ts
  export interface UseDensityResult { density: Density; setDensity: (d: Density) => void; }
  export function useDensity(): UseDensityResult;
  ```
- localStorage key: `'fleet:density'`. Mirror `view-preference.ts` `safeGet`/`safeSet`/`isDensity` exactly.
- Consumed by: T6/Wave 2 (density-aware standard tier).

**Steps:**
- [ ] Write `density-preference.test.ts` failing tests: default `'balanced'` when unset; round-trips `'glanceable'`/`'balanced'`; corrupt value → `'balanced'`; `setItem` throwing → no throw (best-effort). (Use the memory-storage shim from `src/test/setup.ts`.)
- [ ] Run `npm test -- src/lib/density-preference.test.ts` — confirm FAIL.
- [ ] Implement `density-preference.ts` copying the `view-preference.ts` structure (`DENSITY_KEY`, `DEFAULT_DENSITY`, `safeGet`, `safeSet`, `isDensity`, `loadDensityPreference`, `saveDensityPreference`).
- [ ] Run targeted test — confirm PASS. Commit `test`+`feat` pair: `test(density): add density-preference tests` then `feat(density): add density-preference module`.
- [ ] Write `useDensity.test.ts` failing tests: initialises from `loadDensityPreference`; `setDensity('glanceable')` updates state + persists (assert `loadDensityPreference()` after).
- [ ] Run targeted — confirm FAIL → implement `useDensity.ts` (mirror `useTheme` minus the matchMedia branch) → confirm PASS. Commit `test`/`feat` pair.
- [ ] Write `DensityToggle.test.tsx` failing tests: renders a `radiogroup` with 2 options (Balanced/Glanceable), each with redundant icon + text; clicking Glanceable calls `setDensity`/marks it checked; focus ring class present. Mirror `ThemeToggle.test.tsx` assertions.
- [ ] Run targeted — confirm FAIL → implement `DensityToggle.tsx` (mirror `ThemeToggle.tsx`: `radiogroup`, `BASE_BUTTON`/`ACTIVE_BUTTON`/`INACTIVE_BUTTON`, tokenised colours, `aria-hidden` icons) → confirm PASS. Commit `test`/`feat` pair.
- [ ] Add `<DensityToggle />` next to `<ThemeToggle />` in `src/App.tsx` (only when authenticated/dashboard is shown — match where the dashboard view renders); update/add an `App` test asserting it renders. Commit `feat(app): expose density toggle`.
- [ ] Run `npm run lint`.

**Data availability:** N/A (client-only setting).

---

### Wave 1 — Salience wiring + per-tile bodies (T6 || T7–T14, disjoint files)

#### T6 — Wire salience + alias + a11y summary into TileFrame & SignalTile
**Files:**
- Modify: `src/components/tiles/TileFrame.tsx`, `src/components/tiles/TileFrame.test.tsx`, `src/components/SignalTile.tsx`, `src/components/tiles/BigValue.tsx`, `src/components/tiles/BigValue.test.tsx`, `src/components/tiles/types.ts` (+ `types.test.ts`)
- Test: create `src/components/SignalTile.test.tsx` if absent

**Interfaces:**
- Consumes: `resolveSalience` (T3), `AccentBar` thickness (T2), `SIGNAL_IDENTITY_TONE`.
- Produces (additive, all optional so current callers compile):
  ```ts
  // TileFrameProps additions:
  salience?: TileSalience;        // default {tier:'calm', edgeTone:'neutral', tint:false, glow:false, actionableTab:false}
  alias?: string;                 // render alias ?? repo.nameWithOwner
  accessibleSummary?: string;     // activate-button aria-label payload (scope+metric+state)
  identityTone?: AccentTone;      // header status-dot/icon identity colour (calm tiles)
  // types.ts:
  export const SIGNAL_IDENTITY_TONE: Record<TileSignalType, AccentTone>;
  // BigValueProps addition:
  live?: boolean;                 // wraps value in aria-live="polite"
  ```

**TileFrame treatment rules:**
- `salience.tier==='problem'`: `AccentBar thickness="problem"` (6px) with `tone={salience.edgeTone}`; add accent-tinted surface (`color-mix(in srgb, ${toneToVar(edgeTone)} 10%, var(--color-surface))` on the article, behind content) + soft glow (`box-shadow` using `toneToVar(edgeTone)`), both gated by `motion`-safe / static (no pulse).
- `salience.tier==='actionable'`: `AccentBar thickness="calm"` neutral PLUS a persistent info-blue edge tab element (`data-part="actionable-tab"`, `bg-accent-info`, `aria-hidden`); NO tint/glow.
- `salience.tier==='calm'`: `AccentBar thickness="calm"` (5px) `tone="neutral"`; header `StatusDot`/icon uses `identityTone`.
- All transforms/glows respect `prefers-reduced-motion` (static tints are inherently safe).

**Steps:**
- [ ] `types.ts`: add failing test for `SIGNAL_IDENTITY_TONE` (e.g. `activity → 'purple'`, `stale → 'ochre'`, `pullRequests → 'info'`, `reviews → 'info'`, `ci → 'neutral'`, `security → 'neutral'`, `issues → 'neutral'`). Run — FAIL → add the map → PASS. Commit `test`/`feat` pair `(tiles): signal identity tone map`.
- [ ] `BigValue`: add failing test — `<BigValue value={4} live />` renders a `[aria-live="polite"]` wrapper around the value; without `live`, none. Run — FAIL → implement → PASS. Commit pair `(tiles): aria-live hero option on BigValue`.
- [ ] `TileFrame.test.tsx`: add failing tests:
  - problem salience → `AccentBar` has `h-[6px]`; article has `data-salience="problem"`; a tinted/glow element present (`data-part="problem-glow"`).
  - actionable salience → `data-part="actionable-tab"` present; bar is 5px neutral; no `data-part="problem-glow"`.
  - calm → bar 5px, `data-tone="neutral"` on bar; header dot uses `identityTone`.
  - `alias="api"` → header visible text is `api`; a visually-hidden `(alias for octocat/api)` present; `title` still the real `nameWithOwner`.
  - activate button `aria-label` equals `accessibleSummary` when provided (e.g. `CI: 2 failing, problem — octocat/api`), else the legacy label.
- [ ] Run `npm test -- src/components/tiles/TileFrame.test.tsx` — confirm FAIL.
- [ ] Implement `TileFrame` additions (props, salience treatment, alias rendering, aria-label switch, `data-salience` attribute). Keep all existing roving-tabindex / control / `data-status` behaviour unchanged.
- [ ] Run targeted — confirm PASS.
- [ ] `SignalTile.test.tsx`: add failing tests — for a failing-CI `data`, the rendered frame has `data-salience="problem"`; for reviews `requestedCount:2`, `data-salience="actionable"`; `accessibleSummary` includes the signal label + repo. Run — FAIL.
- [ ] Update `SignalTile.tsx`: compute `salience = resolveSalience(tile.signal, data)` (Activity → calm/purple identity), `identityTone = SIGNAL_IDENTITY_TONE[tile.signal]`, build `accessibleSummary` (`${signalLabel}: ${heroMetricText}, ${salience.tier} — ${repo.nameWithOwner}`), pass `salience`/`alias`/`identityTone`/`accessibleSummary` to `TileFrame`. Keep the Activity special-case (no slice).
- [ ] Run `npm test -- src/components/SignalTile.test.tsx` + the frame test — confirm PASS. Run `npm run lint`.
- [ ] Commit `feat(tiles): apply 3-tier salience, alias display, and a11y summary in the tile frame`.

**Data availability:** Salience uses only existing slice fields (T3). Alias prop has no data source yet (Phase 3) — defaults `undefined`, behaviour unchanged. `accessibleSummary` derives from in-slice values.

> **Body tasks T7–T14**: each edits ONE `bodies/*TileBody.tsx` (+ its test) — disjoint, parallelizable. Each MUST keep: the existing loading/error/unknown/ready guards, `data-state`/`data-tone`/`data-tier` attributes, the redundant sr-only sentence, token-only colour, and the 3 size tiers with a fixed hero anchor (compact = hero+delta only; standard adds one micro-viz; expanded adds breakdown). Bodies do NOT paint the edge (TileFrame owns it).

#### T7 — CI body: failing hero + latest-run cell
**Files:** Modify `src/components/tiles/bodies/CiTileBody.tsx`, `CiTileBody.test.tsx`; create `src/components/tiles/RunStrip.tsx` + `RunStrip.test.tsx`.

**Interfaces:**
- `RunStrip` props: `{ conclusion: 'success'|'failure'|'in_progress'|'queued'|'none'; srLabel: string }` → one rounded (radius-2) ~12px cell; **fail carries a non-colour notch** (`<path>`/clip), success a filled cell, running/queued distinct shapes; `aria-hidden` viz + sr-only `srLabel`.
- Consumes: `data.ci` (`conclusion`, `failingCount`, `latestRunUrl`, `updatedAt`), `formatRelativeTime`, `safeGitHubHref`.

**Steps:**
- [ ] Write `RunStrip.test.tsx` failing tests: fail conclusion renders a `[data-shape="notch"]`; success renders `[data-shape="solid"]`; queued/running distinct `data-shape`; sr-label present. Run — FAIL → implement `RunStrip.tsx` → PASS. Commit pair `(tiles): RunStrip latest-run cell`.
- [ ] Add failing `CiTileBody.test.tsx` cases: standard/expanded render `RunStrip` with the slice conclusion; failing slice shows hero failing count + `Failing` word + the relative-time meta (`formatRelativeTime(updatedAt)`); expanded keeps the "View latest run" link; compact shows hero glyph only (no strip); NO "passing"/delta text asserted (removed). Keep existing all-clear / loading / error / unknown cases.
- [ ] Run `npm test -- src/components/tiles/bodies/CiTileBody.test.tsx` — confirm FAIL.
- [ ] Update `CiTileBody.tsx`: keep `resolveView`; add `RunStrip` (standard/expanded) fed by `ci.conclusion`; add recency meta from `ci.updatedAt` via `formatRelativeTime`. Do NOT add a passing count or delta (GAP — see Data availability). Add a code comment citing the deferred run-history gap.
- [ ] Run targeted — PASS. `npm run lint`. Commit `feat(ci-tile): hero failing run + shape-coded latest-run cell`.

**Data availability:** `failingCount` is 0/1 (hook). `passing`/`▲ delta`/10-cell history = GAP → omitted; documented in-file. Recency + newest link IS available.

#### T8 — Security body: replace ArcGauge with severity-led layout
**Files:** Modify `src/components/tiles/bodies/SecurityTileBody.tsx`, `SecurityTileBody.test.tsx`.

**Interfaces:** Consumes `data.security` (`counts`, `grade`, `truncated`, `alerts[].created_at`); reuses `SeverityBar`, `BigValue`, `StatusGlyph`, `formatRelativeTime`. **Removes** the `ArcGauge` import.
- Worst-severity hero: first non-zero of `critical > high > medium > low`; hero text e.g. `2 Critical`; hero tone `critical→failure`, `high→coral` (orange), `medium→info`, `low→neutral`. Map "high" to the `coral` tone (existing orange token) — document that coral covers spec's high/orange.

**Steps:**
- [ ] Add failing tests: standard/expanded render NO arc (`container.querySelector('[data-part="arc"]')` is null / `ArcGauge` not used) and DO render a `SeverityBar` (stacked) + worst-severity hero (`2 Critical` with `text-accent-failure`); `critical:0, high:5` hero is `5 High` tinted coral; total line `11 total`; recency from newest `alerts[].created_at`; clean repo (`total 0`) shows "All clear" success check (not an alarm) — see T16 for the shared treatment; `truncated` shows the `≥`/partial hint. Keep loading/error/unavailable.
- [ ] Run `npm test -- src/components/tiles/bodies/SecurityTileBody.test.tsx` — confirm FAIL.
- [ ] Update `SecurityTileBody.tsx`: delete `ArcGauge`/`GRADE_FILL` usage; compute worst severity from `counts`; render hero `BigValue`/text + counts + stacked `SeverityBar` (segments critical/high/medium/low with tones failure/coral/info/neutral); recency via `formatRelativeTime(maxCreatedAt)` when `alerts` present. Keep `securityGrade` only if still surfaced; otherwise drop the grade hero per spec (worst-severity replaces it).
- [ ] Run targeted — PASS. `npm run lint`. Commit `feat(security-tile): replace arc gauge with worst-severity hero + stacked severity bar`.

**Data availability:** All IS available. Recency present only when `alerts` populated (clean repos omit it).

#### T9 — Open PRs body: new-contributor + oldest-external + segbar
**Files:** Modify `src/components/tiles/bodies/PrsTileBody.tsx`, `PrsTileBody.test.tsx`.

**Interfaces:** Consumes `data.pullRequests` (`openCount`, `externalCount`, `externalPullRequests[].created_at`/`author_association`); reuses `BigValue`, `Chip`, `SeverityBar`, `formatRelativeTime`.

**Steps:**
- [ ] Add failing tests: hero `openCount` (`4`); external>0 → coral hero + new-contributor `Chip`; standard/expanded show **oldest external PR** age (`formatRelativeTime` of the min `created_at`, labelled "oldest new-contributor PR"); a 2-segment `SeverityBar` (external vs other-open, tones coral/info); NO draft count and NO `▲` delta asserted. Keep open=0 "No open PRs" + loading/error/unavailable.
- [ ] Run `npm test -- src/components/tiles/bodies/PrsTileBody.test.tsx` — confirm FAIL.
- [ ] Update `PrsTileBody.tsx`: compute oldest external age from `externalPullRequests`; render 2-seg `SeverityBar` with `max={openCount}`; add a code comment citing the draft-count + overall-oldest + delta GAPs.
- [ ] Run targeted — PASS. `npm run lint`. Commit `feat(prs-tile): surface new-contributor age and external/open split`.

**Data availability:** draft count, `▲` delta, overall-open oldest = GAP → omitted; oldest **external** age IS available. Documented in-file.

#### T10 — Reviews body: ACTIONABLE hero + oldest age
**Files:** Modify `src/components/tiles/bodies/ReviewsTileBody.tsx`, `ReviewsTileBody.test.tsx`.

**Interfaces:** Consumes `data.reviews` (`requestedCount`, `requests[].created_at`); reuses `BigValue`, `Chip`, `StatusGlyph`, `formatRelativeTime`.

**Steps:**
- [ ] Add failing tests: standard/expanded show "oldest 3d" meta (`formatRelativeTime` of the min `requests[].created_at`) when `requests` present; hero count + "awaiting you" retained; tone mapping (`urgencyTone`) retained; count=0 "None awaiting" retained.
- [ ] Run `npm test -- src/components/tiles/bodies/ReviewsTileBody.test.tsx` — confirm FAIL.
- [ ] Update `ReviewsTileBody.tsx`: add oldest-request age meta from `reviews.requests`.
- [ ] Run targeted — PASS. `npm run lint`. Commit `feat(reviews-tile): add oldest-request age meta`.

**Data availability:** All IS available. (Edge ACTIONABLE treatment is applied by TileFrame via T3/T6.)

#### T11 — Issues body: open + cross-slice stale meta
**Files:** Modify `src/components/tiles/bodies/IssuesTileBody.tsx`, `IssuesTileBody.test.tsx`.

**Interfaces:** Consumes `data.issues` (`openCount`, `overThreshold`) AND `data.stale.staleItems` (filter `type==='issue'`) for the "N stale" meta. Body already receives full `RepoSignalData`.

**Steps:**
- [ ] Add failing tests: standard/expanded show "N stale" derived from `data.stale.staleItems` filtered to issues (e.g. `data.stale.staleItems = [{type:'issue'},{type:'pr'}]` → "1 stale"); when `data.stale` absent/loading → no stale meta (no crash); hero/over-threshold behaviour retained; NO `▲3 new` and NO sparkline asserted.
- [ ] Run `npm test -- src/components/tiles/bodies/IssuesTileBody.test.tsx` — confirm FAIL.
- [ ] Update `IssuesTileBody.tsx`: compute stale-issue count from `data.stale?.status === 'ready' ? data.stale.staleItems?.filter(i => i.type === 'issue').length : undefined`; render meta when defined. Comment the delta + sparkline GAP.
- [ ] Run targeted — PASS. `npm run lint`. Commit `feat(issues-tile): add cross-slice stale-issue meta`.

**Data availability:** `▲ new` delta + sparkline = GAP → omitted. Stale-issue count IS available cross-slice.

#### T12 — Stale body: age-led hero + buckets + ochre
**Files:** Modify `src/components/tiles/bodies/StaleTileBody.tsx`, `StaleTileBody.test.tsx`; create `src/components/tiles/AgeBucketBar.tsx` + `AgeBucketBar.test.tsx`.

**Interfaces:**
- `AgeBucketBar` props: `{ buckets: { label: string; value: number }[]; srLabel: string }` rendering >14/>30/>60d segments **height-stepped** (older = taller) so it survives grayscale; sr-only breakdown list.
- Consumes `data.stale` (`staleCount`, `staleItems[].updated_at`/`.type`); reuses `BigValue`, `Chip`; uses `'ochre'` tone (T1) instead of `warning`.
- Age helper: derive each item's age in days from `updated_at` (use a `now` injectable for test determinism, mirroring `formatRelativeTime`).

**Steps:**
- [ ] Write `AgeBucketBar.test.tsx` failing tests: three buckets render height-stepped (assert distinct height classes per bucket); zero-value buckets omitted; sr-list lists each bucket+count. Run — FAIL → implement → PASS. Commit pair `(tiles): AgeBucketBar`.
- [ ] Add failing `StaleTileBody.test.tsx` cases: hero is **oldest age** (e.g. `staleItems` with a 34-day-old `updated_at` → hero `34d`, given an injected `now`); meta `5 items (3 PR · 2 issue)` from count + `type` split; expanded renders `AgeBucketBar`; tone is `ochre` not `warning` (`data-tone="ochre"`); count=0 "Nothing stale" retained; loading/error/unavailable retained.
- [ ] Run `npm test -- src/components/tiles/bodies/StaleTileBody.test.tsx` — confirm FAIL.
- [ ] Update `StaleTileBody.tsx`: compute oldest age + PR/issue split + buckets from `staleItems`; hero shows oldest age (age-led) with the count in meta; swap `warning` → `ochre`; thread an optional `now` prop (default `new Date()`) for testability.
- [ ] Run targeted — PASS. `npm run lint`. Commit `feat(stale-tile): age-led hero, type split, age buckets, ochre tone`.

**Data availability:** All IS available (`updated_at`, `type`, `staleCount`).

#### T13 — Activity body: commits-this-week hero + delta
**Files:** Modify `src/components/tiles/bodies/ActivityTileBody.tsx`, `ActivityTileBody.test.tsx`.

**Interfaces:** Consumes `useCommitActivity` `weeks[].total`; reuses `BigValue`, `Sparkline`, `Heatmap`, `formatDelta` (T4).

**Steps:**
- [ ] Add failing tests: `ok` with `weeks` → hero = last week's `total` (`weeks.at(-1).total`) with a "this week" label; delta `formatDelta(last - prev)` rendered (e.g. weeks `[…,10,13]` → `▲3`); single-week data → delta `'—'`; sparkline + (expanded) heatmap retained; loading/computing/empty/error retained. Assert the hero is NOT the all-weeks sum.
- [ ] Run `npm test -- src/components/tiles/bodies/ActivityTileBody.test.tsx` — confirm FAIL.
- [ ] Update `ActivityTileBody.tsx`: hero = latest-week total; delta = `formatDelta(latest - previous)` (guard <2 weeks → `'—'`); keep sparkline/heatmap. Add a comment citing the "merged PRs/week" GAP (deferred — needs a new Search request) and that commits/week is the coherent stand-in.
- [ ] Run targeted — PASS. `npm run lint`. Commit `feat(activity-tile): hero commits-this-week with weekly delta`.

**Data availability:** "merged PRs/week" = GAP → commits/week fallback (documented). Delta + heatmap IS available.

#### T14 — Fleet summary: inflame + per-repo strip + worst-child
**Files:** Modify `src/components/FleetSummaryTile.tsx`, `FleetSummaryTile.test.tsx`, `src/lib/fleet-summary.ts`, `src/lib/fleet-summary.test.ts`, `src/components/DashboardView.tsx`, `DashboardView.test.tsx`.

**Interfaces:**
- `fleet-summary.ts` adds:
  ```ts
  export interface RepoHealthEntry { repo: string; health: RepoHealth; }
  export function perRepoHealth(rows: Iterable<readonly [string, RepoSignalData]>): RepoHealthEntry[];
  // keyed by nameWithOwner so the tile can show a worst-child chip
  ```
- `FleetSummaryTileProps` adds `entries: RepoHealthEntry[]` (alongside existing `summary`).
- Treatment: edge **inflames** (6px `failure` AccentBar) when `summary.broken > 0` (any failing child), else neutral 5px; per-repo worst-state strip = one height-stepped cell per entry (broken tallest, healthy shortest — grayscale-survivable); worst-child chip names the first `broken` (else first `warning`) repo; ranked footer keeps the existing rollups with act-now (failure) emphasised, info muted.

**Steps:**
- [ ] Add failing `fleet-summary.test.ts` cases: `perRepoHealth` maps a mixed set to `[{repo, health}]` worst-first-classified; empty → `[]`.
- [ ] Run `npm test -- src/lib/fleet-summary.test.ts` — confirm FAIL → implement `perRepoHealth` (reuse `classifyRepoHealth`) → PASS. Commit pair `(fleet): per-repo health entries`.
- [ ] Add failing `FleetSummaryTile.test.tsx` cases: with a broken child → an `AccentBar` `h-[6px]` `data-tone="failure"` (`data-part="fleet-edge"`); all-healthy → 5px neutral; per-repo strip renders one cell per entry with height-stepped classes; worst-child chip shows the broken repo's name; ranked footer rollups retained.
- [ ] Run `npm test -- src/components/FleetSummaryTile.test.tsx` — confirm FAIL.
- [ ] Update `FleetSummaryTile.tsx`: add `entries` prop, the inflame edge, the per-repo strip, the worst-child chip; keep the health `SeverityBar` + rollups.
- [ ] Add failing `DashboardView.test.tsx` case: `FleetSummaryTile` receives `entries` derived from `repoData`. Run — FAIL → in `DashboardView.tsx` compute `const fleetEntries = useMemo(() => perRepoHealth(repoData.entries()), [repoData])` and pass to both `FleetSummaryTile` call sites → PASS.
- [ ] Run `npm run lint`. Commit `feat(fleet-tile): inflaming edge, per-repo worst-state strip, worst-child chip`.

**Data availability:** All derivable from `repoData` (no new fetch). Only plumbing was missing.

---

### Wave 2 — Density + missing-states matrix (depends on Wave 1)

#### T15 — Density-aware standard tier
**Files:** Modify `src/components/SignalTile.tsx` (+ test), `src/components/DashboardView.tsx` (+ test), and each `bodies/*TileBody.tsx` that gains a glanceable variant (+ tests). Consumes `useDensity` (T5).

**Interfaces:** Thread `density: Density` from `DashboardView` (via `useDensity`) → `SignalTile` → `SignalBody` → bodies. In `glanceable`, the **standard** tier renders hero + delta + salience edge ONLY (drop the standard-tier micro-viz/meta); `balanced` is unchanged; compact/expanded tiers are unaffected (additive-tier model, hero anchor fixed).

**Steps:**
- [ ] Add failing tests: with `density="glanceable"` a standard-tier body omits its micro-viz (e.g. CI `RunStrip` absent, Security `SeverityBar` absent) but keeps hero + delta; `density="balanced"` keeps them; expanded always keeps them.
- [ ] Run the affected targeted tests — confirm FAIL.
- [ ] Add a `density?: Density` prop (default `'balanced'`) down the `SignalTile → SignalBody → body` chain; gate standard-tier extras on `density === 'balanced' || size === 'expanded'`. Wire `useDensity()` in `DashboardView` and pass it.
- [ ] Run targeted tests — PASS. `npm run lint`. Commit `feat(tiles): density-aware standard tier (balanced/glanceable)`.

**Data availability:** N/A (presentation only).

#### T16 — Missing-states matrix
**Files:** Create `src/components/tiles/TileMessage.tsx` + `TileMessage.test.tsx`; modify every `bodies/*TileBody.tsx` (+ tests) to route loading / empty-`0` "All clear" / failed-to-load through it; modify Security + Fleet for `partial`.

**Interfaces:** `TileMessage` props `{ kind: 'loading' | 'all-clear' | 'failed' | 'partial'; message: string; srText: string; onRetry?: () => void }` → distinct glyph + `data-state` (`loading`/`empty`/`failed-to-load`/`partial`) + sr-text; `failed` renders a "⚠ Couldn't load" + a "Retry" button **only when `onRetry` is provided**.

**Hard rule (spec §7):** empty-`0` ("All clear", success check, calm) MUST be visually unmistakable from `failed-to-load` (⚠, failure). Tests assert different glyph + different `data-state`.

**Steps:**
- [ ] Write `TileMessage.test.tsx` failing tests: each `kind` → its `data-state` + glyph; `all-clear` uses a success check, `failed` a `⚠`/failure glyph (distinct); `failed` shows Retry only with `onRetry`; sr-text present. Run — FAIL → implement → PASS. Commit pair `(tiles): shared TileMessage state row`.
- [ ] Per body, add failing tests asserting the `0`-state renders `data-state="empty"` "All clear" via `TileMessage` and the error-state renders `data-state="failed-to-load"` — and that the two are distinguishable. Run — FAIL.
- [ ] Refactor each body's loading / zero / error branches to use `TileMessage` (preserve existing sr sentences). For Security, map `truncated` → `partial`; for Fleet, surface a `partial` hint when a future partial count exists (today: no-op placeholder gated on data, documented).
- [ ] Run the full bodies test set — PASS. `npm run lint`. Commit `feat(tiles): unify the missing-states matrix across bodies`.
- [ ] Add an in-repo note (code comment + `DECISIONS.md`) that `not-configured` / `stale-cache` / `rate-limited` need new `SignalStatus` metadata and are deferred; per-tile `Retry` is wired only where `onRetry` is plumbed (else relies on the view-level retry).

**Data availability:** loading/empty/failed IS representable; `partial` only for Security (`truncated`). `not-configured`/`stale-cache`/`rate-limited` = GAP → deferred.

---

### Wave 3 — A11y, grayscale, contrast (depends on Wave 1–2)

#### T17 — Alias + a11y wiring completion
**Files:** Modify `src/components/SignalTile.tsx` (+ test), `src/components/tiles/TileFrame.tsx` (+ test) if any aria refinement remains after T6; ensure hero `BigValue` uses `live` for the count.

**Interfaces:** Consumes the `alias`/`accessibleSummary`/`live` plumbing from T6.

**Steps:**
- [ ] Add failing tests: hero count region has `aria-live="polite"` (never `assertive`); when an alias is present the activate `aria-label` still announces the real `owner/repo`; `.sig`/decorative icons are `aria-hidden`. (Alias source remains a Phase-3 stub — pass a test alias prop through `SignalTile`.)
- [ ] Run targeted — FAIL → set `live` on the hero `BigValue` in each body that owns the count, and finalize `SignalTile` alias pass-through → PASS.
- [ ] `npm run lint`. Commit `feat(a11y): live hero count + alias-safe accessible names`.

**Data availability:** Alias = stub prop (no persistence). a11y derives from existing values.

#### T18 — Grayscale-redundant micro-viz
**Files:** Modify `src/components/tiles/SeverityBar.tsx` (+ test), `RunStrip.tsx` (T7 — verify), `AgeBucketBar.tsx` (T12 — verify), `src/components/tiles/Heatmap.tsx` (+ test — floor low cells), Fleet per-repo strip (T14 — verify).

**Interfaces:** `SeverityBar` gains a non-colour channel: a 1px inter-segment divider (`border-l border-surface`) + optional height-step; `Heatmap` floors empty/low cells to a visible min so zero ≠ low ambiguity stays ≥3:1.

**Steps:**
- [ ] Add failing tests: `SeverityBar` segments carry a divider/height channel distinguishable without colour; `Heatmap` low/zero cells render a floored min height/opacity (assert class/style). Verify `RunStrip`/`AgeBucketBar`/Fleet-strip already encode shape/height (add tests if missing).
- [ ] Run targeted — FAIL → implement the non-colour channels → PASS.
- [ ] `npm run lint`. Commit `feat(tiles): add grayscale-survivable shape/height channels to micro-viz`.

**Data availability:** N/A (encoding only).

#### T19 — Light-theme contrast verification
**Files:** Create/extend `src/index.test.ts` (or `src/lib/tokens.test.ts`) parsing `src/index.css`; update `DECISIONS.md`.

**Interfaces:** A test asserting every NEW `--color-*` token (`--color-ochre`, and any high-severity token if added) is defined in BOTH `:root` and `.dark`; a `DECISIONS.md` table of computed AA ratios (token × theme × surface) for new/changed pairings (ochre ink, coral-as-high).

**Steps:**
- [ ] Add failing test: read `src/index.css`; assert `--color-ochre` appears under both a `:root {` and a `.dark {` block (regex/section parse). Run — FAIL (if token only added in one place) → ensure both → PASS.
- [ ] Compute and record AA ratios for: ochre-ink on light `#ffffff` and dark `#161b22`; coral (high severity) text on both surfaces; confirm ≥4.5:1 (text) / ≥3:1 (bar fills). Write the table to `DECISIONS.md`.
- [ ] `npm run lint`. Commit `test(tiles): assert new tokens defined per-theme + document AA ratios`.

**Data availability:** N/A.

---

## Self-Review

**Spec §3–§9 coverage map:**
- **§3 (3-tier salience)** → T3 (resolver), T6 (TileFrame application), T14 (Fleet inflame). PROBLEM tint+glow+6px / ACTIONABLE info tab / CALM neutral 5px all in T6.
- **§4 (design system: tokens, chrome, grid, anatomy)** → T1 (ochre token), T2 (5/6px bar), T6 (chrome/anatomy: hero anchor, header, edge), T4 (`formatDelta` for §4.4 deltas). Tokenisation/per-theme already met; extended not replaced.
- **§5 (per-tile spec)** → CI T7, Security T8, Open PRs T9, Reviews T10, Issues T11, Stale T12, Activity T13, Fleet T14. Redundant status channels → T18.
- **§6 (density ↔ size tiers)** → T5 (preference/hook/toggle) + T15 (density-aware standard tier). Additive tiers preserved (compact/expanded untouched).
- **§7 (states)** → T16 (loading / empty-"All clear" / failed-to-load distinct; Security `partial`); deferred states flagged.
- **§8 (a11y AA)** → T6 + T17 (aria-label scope+metric+state, aria-live hero, alias + visually-hidden real repo, `aria-hidden` icons), T18 (floored heatmap / non-colour channels), T19 (per-theme tokens + ratios).
- **§9 (display vs edit)** → unchanged; the whole-tile activate overlay + reserved edit zone in `TileFrame` are preserved by every task (no task touches the edit-mode control rail behaviour).
- **§11 decisions** → Q1 density (T5/T15), Q2 Fleet inflame (T14), Q3 Activity metric (T13, with documented merged-PR GAP).
- **§12 implementation notes** → ArcGauge replaced (T8); salience prop (T6); density prop+module (T5/T15); severity-led Security (T8); age-led Stale (T12); Activity hero (T13); missing-states (T16); alias + a11y (T6/T17); per-theme tokens (T1/T19). Refactor-not-rewrite honoured (primitives reused throughout).

**Placeholder scan:** No "TBD"/"add error handling"/"tests for the above" steps; every step names a concrete file, assertion, or command. Every referenced symbol is defined in a task: `TileSalience`/`resolveSalience`/`SalienceTier` (T3), `formatDelta` (T4), `Density`/`loadDensityPreference`/`saveDensityPreference`/`useDensity` (T5), `SIGNAL_IDENTITY_TONE`/`alias`/`accessibleSummary`/`BigValue.live` (T6), `RunStrip` (T7), `AgeBucketBar` (T12), `perRepoHealth`/`RepoHealthEntry`/`FleetSummaryTileProps.entries` (T14), `TileMessage` (T16), `accent-ochre`/`'ochre'` tone (T1).

**Type-name consistency:** `AccentTone` (extended with `'ochre'`, T1) used identically across resolver/bodies/tile-frame; `SalienceTier` literal set `'problem'|'actionable'|'calm'` identical in T3 and T6; `Density` literal set `'balanced'|'glanceable'` identical in T5/T15; `TileTier` (`compact|standard|expanded`) unchanged and reused; `RepoHealth` (`broken|warning|healthy`) reused by `perRepoHealth`. No task introduces a symbol consumed before its defining task in wave order.

**Top risks for implementers:**
1. **CI `failingCount` is 0/1, not a true count** (the hook sets `1` on a failed latest run) — don't promise "N failing workflows"; the hero is a run-state, and the 10-cell history strip is a GAP. Keep copy honest (T7).
2. **Activity "merged PRs/week" has no data source** — using commits/week is a deliberate, documented substitution to respect no-new-request; a reviewer expecting literal merged-PR counts must read the Data availability note (T13).

---

## Red-Team Revisions (BINDING — apply with the referenced task)

An independent red-team verified every path/interface/type/data-claim against the codebase (no blockers; "SAFE TO EXECUTE with minor revisions"). The following adjustments are binding; T3/T4 commit-pairs were already fixed inline above.

- **R1 (T6) — define the hero-metric source for `accessibleSummary`.** The hero metric is computed inside each body, and **Activity has no slice on `RepoSignalData`** (it is fetched in the body via `useCommitActivity`). Add a pure helper `signalHeroSummary(signal, data): string` (in `src/lib/tile-salience.ts` or a new `src/lib/tile-summary.ts`; test/feat pair) consumed by both the body and `SignalTile` for the scope+metric+state aria-label. For **Activity**, `SignalTile` cannot know the metric → the frame label falls back to scope+state and `ActivityTileBody` owns the live hero announcement via its own `aria-live` region. Document this.
- **R2 (T6 + T13) — T6 OWNS rewriting the existing tone-driven tests; Activity identity = PURPLE.** T6 makes the bar salience-driven (not `tone`-driven), which breaks `TileFrame.test.tsx` (tone→bar assertions) and `SignalTile.test.tsx` (Activity `[data-tone="success"]`). T6 MUST rewrite these **in place** to assert the new salience behaviour **without weakening** any existing redundancy/contrast assertion (ratchet). **Decision: Activity identity = purple** (spec §5 "purple icon"): set `SIGNAL_IDENTITY_TONE.activity='purple'`, remove the now-dead `ACTIVITY_TONE='success'` path in `SignalTile`, and **repaint the Activity viz (sparkline/heatmap) purple in T13** so header + hero + viz share one accent; update `ActivityTileBody.test.tsx`.
- **R3 (T7) — drop `AmbientGlow` from `CiTileBody`.** The frame now owns the PROBLEM glow+tint (T6); the body's own `AmbientGlow` would double-glow on failure. Remove it (CI is the only `AmbientGlow` caller) and update the CI body test.
- **R4 (T14) — Fleet inflame trigger + thickness note.** Keep inflame on `summary.broken > 0` (via `classifyRepoHealth`, "broken" spans failing CI **and** security D–F / issues-over-threshold = "any child unhealthy", matching the cofounder's intent). Record the deliberate deviation from spec §4.2 (Fleet 6px-always) — the plan uses 5px-neutral healthy / 6px inflamed so thickness doubles as the inflame cue — in the task + `DECISIONS.md`.
- **R5 (T8/T18) — severity *text* uses the ink token.** "High"/orange severity TEXT uses `--color-coral-ink` (`text-accent-coral-ink`), not the `coral` fill token, to clear AA (spec §4.1/§8: fill `#db6d28` vs ink `#e8804f`); fills keep `coral`. Avoids a T19 contrast rework.
- **R6 (T6/T17) — scope `aria-live`.** Applying `aria-live="polite"` to every hero across 8+ tiles risks announcement floods per poll → apply `live` only to PROBLEM/ACTIONABLE heroes (the ones a user must react to), not calm informational tiles. Document the decision.
- **R7 (T6) — edit `SignalTile.test.tsx` in place** (it already exists); rewrite the affected assertions rather than appending a second suite.
3. **Calm tiles change the bar to neutral** (identity colour moves to the header icon per §3) — this is a visible behaviour change from today's identity-coloured bars; ensure `SIGNAL_IDENTITY_TONE` + `TileFrame` keep colour-blind redundancy (icon + text) and that snapshot/contrast tests are updated, not weakened (T6/T18).
