# Design Spec — Dashboard 2.0 Tile Redesign ("Signal Keys")

Status: **DRAFT (brainstorming terminal artifact)** · Date: 2026-06-21 · Owner: coordinator
Supersedes/extends: `docs/DESIGN-TILES.md`. Compiled from: `tile-design-constitution.md`,
`tile-iteration-brief.md`, and the 6-expert panel (`research-ui-prompting.md`, `research-tile-ux2.md`,
`crit-data.md`, `crit-proportion.md`, `crit-ux.md`, `crit-a11y.md`). Visual reference:
`signal-keys-tiles-v2.html`.

> This is the DESIGN contract for the tile redesign. It is reviewed by the cofounder, then converted to a
> PR-sized implementation plan (writing-plans) and built by the fleet (TDD + Sentinel), refactoring the
> existing `src/components/tiles/**` primitives + bodies. **No implementation code until this spec is
> approved.** Two design decisions remain OPEN (see §11) — everything else is settled.

---

## 1. Problem & goal
The dashboard tiles (from the dark-theme milestone) are directionally right but under-tuned: every tile
competes for attention, numbers lack context, proportions are off-grid, and several micro-vizzes are
color-blind-invisible. Goal: a **calm, glanceable fleet console** where a user triages "what needs me?"
in <2s, problems and assigned-to-me work pop, and healthy repos recede — premium and WCAG 2.1 AA in both
themes. Scope here = **tile redesign only**. Default-view config and Stream-Deck customization are later
Dashboard 2.0 phases (§10).

## 2. Decisions locked
- **Direction: "Signal Keys"** — Stream-Deck-key-inspired tiles (flat-2.0 keycap surface).
- **Header: H2 repo-only**, single line, ellipsis truncation; renders **`alias ?? repo`**.
- **Per-repo alias** is a user setting (client-only; belongs to the customization phase, but tiles must
  display it and announce the real `owner/repo` to assistive tech).
- **8 tile types:** CI · Security · Open PRs · Reviews · Issues · Stale · Activity · Fleet summary.

## 3. The 3-tier salience model (core principle)
Calm by default; only two things earn color:

| Tier | Tiles / condition | Treatment |
|---|---|---|
| **PROBLEM** | CI failing · Security warn/critical · any fail/warn | Saturated top edge **6px** + accent-tinted surface (`color-mix 10%`) + soft 18px glow. |
| **ACTIONABLE-TO-ME** | Reviews awaiting you · review-requested PRs (count>0) | **Info-blue** persistent edge tab + brighter hero. **No tint/glow.** "Your move" ≠ "on fire". |
| **CALM** | All healthy / informational | **Neutral low-chroma top rail (5px)**; type identity lives in the **header icon only**, never a colored bar. |

## 4. Design system
### 4.1 Tokens (dark; centralize as CSS custom properties — no inline status hex)
canvas `#0d1117` · surface `#161b22` · raised `#1c2230` · border `#30363d` · text `#e6edf3` ·
text2 `#c9d1d9` · muted `#8b949e` · success `#3fb950` · warn `#d29922` (text ink `#e3b341`) ·
fail `#f85149` · info `#58a6ff` · purple `#bc8cff` · high/orange fill `#db6d28` (text ink `#e8804f`) ·
stale ochre `#8a6d3b` · low-sev `#6e7681` · viz track `#21262d`.
**Light theme** (build must define per-theme tokens): muted→`#475569` · fail-text→`#d1242f` ·
warn-ink→`#9a6700` · success→`#1a7f37` · info→`#0284c7` · purple→`#8250df` · orange-text→`#c2410c` ·
text→`#0f172a`. (Never use the dark amber `#e3b341` on light.)

### 4.2 Chrome (flat 2.0)
1px border `#30363d` + one surface step + 1px inset top highlight (`::after`, `top` = edge height) +
restrained resting shadow; low elevation rising on hover (`translateY(-2px)`), settling on press
(`:active translateY(0) scale(.985)` + inset). **Top accent bar: 5px standard / 6px PROBLEM + Fleet**
(3px necked at the 14px corner radius — fixed). All transforms gated by `prefers-reduced-motion`.

### 4.3 Grid & rhythm (8pt spine)
Padding **16px**; internal gaps **8/12/16** (4px icon↔text only); grid gap **20px**;
`minmax(248px,1fr)`; min-height **188px**; tile aspect **1.3–1.5:1**; radius 14 outer / 2 on every
micro-viz. Single **micro-viz band height ≈12px**. Fleet tile spans 2 columns.

### 4.4 Anatomy (top→bottom)
salience edge → header (`icon + repo/alias`) → **hero (one dominant element)** → meta. Hero label =
11px UPPERCASE +0.10em tracked muted; meta = 11px sentence-case muted (label must not be out-ranked by
meta). Numbers: **tabular-nums**, abbreviate ≥10k (`1.2k`), relative time `2m/3d/34d`, deltas `▲n/▼n`
colored **on the delta only**, by meaning.

## 5. Per-tile spec
| Tile | Hero | Context/meta | Supporting viz | Salience |
|---|---|---|---|---|
| **CI** | `N` failing (octagon-X glyph) | `▲2 since yest` · `9 passing · 2m · newest →` | win/loss run strip (10 cells, direction only; fail cell carries a **non-color** notch/shape) | PROBLEM red 6px |
| **Security** | **worst severity** `2 Critical` (red) | `11 total` · `2 critical · 5 high · 1h` | honest **stacked severity bar** (no fake threshold tick) OR true bullet | PROBLEM red 6px when critical>0; amber for high/med-only |
| **Open PRs** | `4` open | `1 new contributor ▲` · `1 draft · oldest 6d` | segbar (review/new/draft) [denser tiers] | CALM (blue icon) |
| **Reviews** | `2` awaiting **you** (blue) | `oldest 3d` | "Needs you" edge tab | **ACTIONABLE** blue |
| **Issues** | `7` open | `▲3 new · 2 stale` | sparkline [detailed tier only] | CALM |
| **Stale** | **`34d` oldest** (age-led) | `5 items (3 PR · 2 issue)` | age-bucket bar (>14/>30/>60d) | CALM **ochre** (not warn amber) |
| **Activity** | `18` merged PRs/wk | `▲ vs last wk` | mini-heatmap (floored low cells) | CALM (purple icon) |
| **Fleet** | `12·3·1` health (healthy/attention/failing) | ranked footer: act-now emphasized, info muted | health bar + per-repo worst-state strip (height-stepped by state) + worst-child chip | anchor, 2-col, 6px; **edge inflames red when any child fails** (else neutral) |

Redundant status channels everywhere (color + distinct shape/icon + text); every micro-viz must survive
grayscale (states currently collapse — add shape/height/notch).

## 6. Density ↔ size-tier model
The 3 density variants map directly onto the Apple-widget **additive size tiers** (hero anchor fixed,
never reflows; each larger tier ADDS, never rearranges):
- **Compact** ≈ *Glanceable*: header + hero + one delta + salience edge. (Wall-of-repos.)
- **Standard** ≈ *Balanced*: + one decision-relevant micro-viz + concise meta. **Default density.**
- **Expanded** ≈ *Detailed*: + breakdown/legend/sparkline/heatmap + ranked footer.

**User density preference (cofounder-confirmed):** the dashboard defaults to **Balanced**, with a user
toggle to **Glanceable** (leaner — hero + delta only) — a client-side setting like theme/view-preference
(§10 Phase 2). **Detailed** remains the **expanded** size-tier / drill treatment, not a global toggle.

## 7. States (shared treatment across all 8 types)
`loading` (skeleton, keep chrome) · **`empty=0` → "All clear"** (calm check, NOT an alarm) ·
`not-configured` (setup prompt) · **`failed-to-load`** (⚠ "Couldn't load · Retry") · `stale-cache`
("as of 12m ago", dimmed) · `rate-limited` (specific copy) · Fleet `partial` ("14/16 · 2 unavailable").
**Hard rule: empty-but-healthy `0` and failed-to-load must be visually unmistakable from each other.**

## 8. Accessibility (AA, both themes)
Tiles are real `<button>`/`<a>` (Enter/Space) with `aria-label` = **scope + metric + state**; `.sig`
icons `aria-hidden`; alias in real text + visually-hidden `(alias for owner/repo)`; hero count in
`aria-live="polite"` (never assertive). Contrast: high/orange text `#e8804f`; halo the budget tick; floor
heatmap low cells ≥3:1. Per-theme functional tokens (no inline hex). Focus-visible sky ring.

## 9. Interaction (display vs edit)
Display mode: whole-tile click = drill-down; cursor pointer; keycap press feedback. Edit/customize is a
separate MODE (later phase) exposing drag-handle / remove / config in a **reserved top-right zone** that
display content never uses. Spannable tile vocabulary: 1×1, 2×1, 2×2 (Fleet = 2×1).

## 10. Out of scope (later Dashboard 2.0 phases)
- **Phase 2 — default view + density:** make dashboard the default + a user-configurable default among
  grid/dashboard/inbox (`src/lib/view-preference.ts`, `DEFAULT_VIEW`); and a **user density preference**
  (Balanced default ↔ Glanceable) as a client-side setting (new `density-preference` module mirroring
  theme/view-preference, + a toggle in the UI).
- **Phase 3 — customization:** select/add/remove tiles · per-repo filter (global scope chip, not 8 repo
  headers) · drag-drop arrange · per-repo alias editor. Extends the M10 edit mode.

## 11. Decisions (Q1 cofounder-confirmed; Q2–Q3 autopilot defaults, overridable on review)
1. **Standard-tier default density = V2 Balanced — CONFIRMED**, with a user toggle to **V1 Glanceable**
   (client-side density preference; see §6/§10/§12). Detailed = expanded-tier treatment, not a toggle.
2. **Fleet edge = inflame red when any child is failing** (neutral when all-green); red also stays in the
   worst-child chip.
3. **Activity metric = merged PRs / week** (kills the prior "↑18 … steady" contradiction); a "last commit"
   liveness signal can be revisited later.

## 12. Implementation notes (for writing-plans)
Refactor, don't rewrite: reuse `src/components/tiles/` primitives (StatusGlyph, Sparkline, Heatmap,
AccentBar, BigValue, Chip, SeverityBar, TileFrame, useTileSize) + `bodies/*`. Replace ArcGauge usage
(Security) with the stacked-severity/bullet component. Add: salience-tier prop, a **density prop
(balanced|glanceable)** on the standard tier + a client-side density-preference module/toggle (default
balanced), severity-led Security logic, age-led Stale, Activity hero metric, the missing-states matrix,
alias display + a11y wiring, per-theme token map. Each increment = TDD (failing `test()` → `feat|fix()`), Sentinel-reviewed. Ratchet:
coverage ≥80%, AA non-negotiable.

## 13. Acceptance criteria
- All 8 tiles render in 3 size tiers with a fixed hero anchor; salience model applied; AA in both themes
  (computed ratios documented); every micro-viz survives grayscale; all 7 states designed and distinct;
  keyboard + SR verified; tabular numerals + contextual deltas everywhere; no inline status hex.
