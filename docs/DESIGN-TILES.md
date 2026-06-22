# DESIGN-TILES — Tile & Theme Design Spec

> **Superseded for the tile redesign by [`docs/superpowers/specs/2026-06-21-dashboard-tile-redesign-design.md`](./superpowers/specs/2026-06-21-dashboard-tile-redesign-design.md)** ("Signal Keys" / Dashboard 2.0). This document remains the source of truth for the design tokens and theme system; the per-signal tile visuals and salience model are now specified there.

> **Status:** Contract / source of truth. Every downstream redesign PR (dark
> theme, tile redesign, the new Activity tile) builds from this document.
> **Scope:** design tokens (light + dark), the status/icon system, the shared
> web-tile anatomy, per-signal tile specs, the shared-primitive inventory, and a
> mapping of which existing atoms survive. This doc specifies; it changes **no
> code**. Each section names the downstream task that implements it.

## 0. Why this exists

`SignalTile` today is a white card with a 4px left accent band wrapping the
compact `*Cell` table atoms (`src/components/SignalTile.tsx`). Those atoms were
designed for a dense table row, so a resizable dashboard tile — which is far
larger than a 144×144 Stream Deck key — currently shows a table cell floating in
white space. We are fixing two things at once:

1. **A dark theme.** The prior-art Stream Deck plugin
   [`pedrofuentes/stream-deck-github-utilities`](https://github.com/pedrofuentes/stream-deck-github-utilities)
   _is_ a dark GitHub theme. We adopt its palette as our dark-theme tokens, so
   the two efforts share **one** design language.
2. **A tile redesign.** We scale the Stream Deck button/touch-strip anatomy
   (accent bar, hero value, status glyph, sparkline, arc gauge, heatmap, ambient
   glow) _up_ to the larger, resizable web tile, and make tiles size-responsive.

### Grid context (do not re-derive — taken from current source)

| Constant | Value | Source |
| --- | --- | --- |
| Grid columns | `12` (all breakpoints) | `DashboardView.tsx` `COLS` |
| Row height | `96px` | `DashboardView.tsx` `ROW_HEIGHT` |
| Gutter / margin | `[16, 16]` | `DashboardView.tsx` `MARGIN` |
| Default tile | `w: 3, h: 2` → ≈ 287×208px at the `lg` (≥1200px) breakpoint | `dashboard-layout.ts` `TILE_WIDTH`/`TILE_HEIGHT` |
| Breakpoints | `lg 1200 / md 996 / sm 768 / xs 480 / xxs 0` | `DashboardView.tsx` `BREAKPOINTS` |

So the smallest reasonable tile (`w:2, h:1` ≈ 181×96px) is still bigger than a
Stream Deck key, and a stretched tile (`w:6, h:4` ≈ 590×432px) has room for rich
visuals. **Tiles must adapt their content to their measured size** (§3.4).

---

## 1. Design tokens — light + dark

### 1.1 Strategy (for the `theme-tokens` task)

- **Tailwind:** set `darkMode: 'class'` in `tailwind.config.js`. A `.dark` class
  on `<html>` (toggled by a `useTheme` hook persisting to `localStorage`,
  defaulting to `prefers-color-scheme`) flips the whole tree. No per-component
  `dark:` variants on color — components reference **semantic tokens only**.
- **CSS-variable-backed semantic tokens.** Define the raw hex once per theme as
  CSS custom properties in `src/index.css`, then map Tailwind color utilities to
  those variables in `theme.extend.colors`. Components write
  `bg-surface text-text border-border` etc. — never `bg-white`/`bg-slate-900`.

  ```css
  /* src/index.css — illustrative; the theme-tokens task owns the final values */
  :root {
    --color-bg: #f1f5f9;            /* page (slate-100) */
    --color-surface: #ffffff;       /* tile */
    --color-surface-raised: #f8fafc; /* nested panel (slate-50) */
    --color-text: #0f172a;          /* slate-900 */
    --color-text-muted: #475569;    /* slate-600 */
    --color-border: #e2e8f0;        /* hairline (slate-200) — decorative */
    --color-border-strong: #64748b; /* structural/state (slate-500) */
    --color-success: #047857;       /* emerald-700 */
    --color-failure: #b91c1c;       /* red-700 */
    --color-warning: #b45309;       /* amber-700 */
    --color-info: #0369a1;          /* sky-700 */
    --color-neutral: #475569;       /* slate-600 */
    --color-warning-ink: #92400e;   /* amber-800 — tinted-badge text (§1.5) */
    --color-coral-ink: #9a3412;     /* orange-800 — tinted-badge text (§1.5) */
    --color-coral: #c2410c;         /* orange-700 — extended accent */
    --color-purple: #7e22ce;        /* purple-700 — extended accent */
    --color-gold: #a16207;          /* yellow-700 — extended accent */
    --color-ochre: #7c5e10;         /* age-led stale, AA-corrected (ADR-020) */
    --color-focus: #0369a1;         /* sky-700 */
  }
  .dark {
    --color-bg: #0d1117;
    --color-surface: #161b22;
    --color-surface-raised: #21262d;
    --color-text: #e6edf3;
    --color-text-muted: #8b949e;
    --color-border: #30363d;        /* decorative hairline */
    --color-border-strong: #6e7681; /* structural/state */
    --color-success: #3fb950;
    --color-failure: #f85149;
    --color-warning: #d29922;
    --color-info: #58a6ff;
    --color-neutral: #8b949e;
    --color-warning-ink: #d29922;
    --color-coral-ink: #f78166;
    --color-coral: #f78166;
    --color-purple: #a371f7;
    --color-gold: #e3b341;
    --color-ochre: #bfa05a;
    --color-focus: #58a6ff;
  }
  ```

  ```js
  // tailwind.config.js — theme.extend.colors (illustrative)
  colors: {
    bg: 'var(--color-bg)',
    surface: 'var(--color-surface)',
    'surface-raised': 'var(--color-surface-raised)',
    text: 'var(--color-text)',
    'text-muted': 'var(--color-text-muted)',
    border: 'var(--color-border)',
    'border-strong': 'var(--color-border-strong)',
    'accent-success': 'var(--color-success)',
    'accent-failure': 'var(--color-failure)',
    'accent-warning': 'var(--color-warning)',
    'accent-info': 'var(--color-info)',
    'accent-neutral': 'var(--color-neutral)',
    'accent-warning-ink': 'var(--color-warning-ink)',
    'accent-coral': 'var(--color-coral)',
    'accent-coral-ink': 'var(--color-coral-ink)',
    'accent-purple': 'var(--color-purple)',
    'accent-gold': 'var(--color-gold)',
    'accent-ochre': 'var(--color-ochre)',
    focus: 'var(--color-focus)',
  }
  ```

- **SVG visuals** (sparkline / arc / heatmap / glyphs) cannot use Tailwind
  classes for `fill`/`stroke`. They read the **same** CSS variables via
  `fill="var(--color-success)"` / `stroke="currentColor"`, so a single theme
  flip recolors everything. Primitives accept a `tone` prop that resolves to a
  variable (§5), never a hard-coded hex.
- **`DrillDownDrawer` stays dark in both themes.** It is already an intentional
  dark, AA surface (`bg-slate-900` / `text-slate-100` / `border-slate-800` /
  `text-sky-300`, `src/components/DrillDownDrawer.tsx`). Do **not** re-theme it
  light. When the dark theme ships, the drawer’s slate values should be migrated
  to the dark tokens above (they are near-identical) for consistency, but its
  light-mode appearance must not change.

### 1.2 Core semantic tokens

| Token | Light hex | Dark hex | Role |
| --- | --- | --- | --- |
| `bg` | `#f1f5f9` slate-100 | `#0d1117` | Page background behind the grid |
| `surface` | `#ffffff` | `#161b22` | Tile / card body |
| `surface-raised` | `#f8fafc` slate-50 | `#21262d` | Nested panel, footer strip, badge tint base |
| `text` | `#0f172a` slate-900 | `#e6edf3` | Primary text, hero values |
| `text-muted` | `#475569` slate-600 | `#8b949e` | Labels, metadata, secondary text |
| `border` | `#e2e8f0` slate-200 | `#30363d` | Decorative hairline only (see note) |
| `border-strong` | `#64748b` slate-500 | `#6e7681` | Structural / state-bearing boundaries, control outlines |
| `focus` | `#0369a1` sky-700 | `#58a6ff` | Focus ring |

> **Border note (SC 1.4.11).** `border` is decorative — it sits between two
> surfaces of similar luminance (dark `#30363d` on `#0d1117` = **1.55:1**, on
> `#161b22` = **1.42:1**; light `#e2e8f0` on white ≈ 1.2:1) and must **never** be
> the sole indicator of a boundary, state, or interactive affordance. Any border
> that conveys meaning (selected, focused, the keyboard Move/Resize controls, a
> chip outline) uses **`border-strong`** which clears 3:1 (dark `#6e7681` on
> `#161b22` = **3.77:1**; light `#64748b` on white = **4.76:1**). Today’s
> `slate-300` control borders (`#cbd5e1` ≈ 1.48:1) and `slate-400` (**2.56:1**)
> both **fail** and must move to `border-strong`.

### 1.3 Status / accent tokens

| Token | Light hex | Dark hex | Meaning |
| --- | --- | --- | --- |
| `accent-success` | `#047857` emerald-700 | `#3fb950` | Passing / healthy / clear |
| `accent-failure` | `#b91c1c` red-700 | `#f85149` | Failing / critical / broken |
| `accent-warning` | `#b45309` amber-700 | `#d29922` | Running / degraded / needs triage / stale |
| `accent-info` | `#0369a1` sky-700 | `#58a6ff` | Queued / informational / open counts |
| `accent-neutral` | `#475569` slate-600 | `#8b949e` | No data / skipped / disabled / muted |

**Extended accents** (dark from Stream Deck; light = nearest AA-safe Tailwind),
used for secondary highlights — external contributors, releases, activity:

| Token | Light hex | Dark hex | Used by |
| --- | --- | --- | --- |
| `accent-coral` | `#9a3412` orange-800 (text) / `#c2410c` orange-700 | `#f78166` | New-contributor / external-PR highlight |
| `accent-purple` | `#7e22ce` purple-700 | `#a371f7` | Releases / deploys (future) |
| `accent-gold` | `#a16207` yellow-700 | `#e3b341` | Stars / emphasis (future) |

### 1.4 Per-signal accent assignment

Each signal maps to a semantic accent. The accent is **state-driven** where the
signal has states (CI, Security); otherwise it has a fixed identity accent that
escalates to `warning`/`failure` on threshold breach.

| Signal | Default accent | Escalates to |
| --- | --- | --- |
| CI / Actions | by run status (§2.1) | `accent-failure` on failure |
| Security | by grade (§4.2) | `accent-failure` at grade D–F |
| Pull requests | `accent-info` | `accent-coral` when external/new-contributor PRs present |
| Reviews | `accent-neutral` (none) | urgency scale (§4.4): `accent-info` (1–2) → `accent-warning` (3–4) → `accent-failure` (5+) |
| Issues | `accent-neutral` | `accent-warning` when over triage threshold |
| Stale | `accent-neutral` | `accent-warning` when `staleCount > 0` |
| Activity | `accent-success` (sparkline/heatmap ink) | — (informational; no alarm state) |
| Fleet summary | composite (§4.8) | split bar segments use success/warning/failure |

### 1.5 Contrast verification (WCAG 2.1)

All ratios computed with the WCAG relative-luminance formula. **Pass thresholds:
≥4.5:1 normal text, ≥3:1 large text (≥18.66px bold / ≥24px) and non-text UI
(SC 1.4.11).** Every pairing the redesign uses is listed; failures are called out
with the required substitution.

#### Dark theme — text on surfaces

| Foreground | Background | Ratio | Normal text | Large/UI |
| --- | --- | --- | --- | --- |
| `text` `#e6edf3` | `bg` `#0d1117` | **16.02** | ✅ | ✅ |
| `text` `#e6edf3` | `surface` `#161b22` | **14.64** | ✅ | ✅ |
| `text` `#e6edf3` | `surface-raised` `#21262d` | **12.88** | ✅ | ✅ |
| `text-muted` `#8b949e` | `bg` `#0d1117` | **6.15** | ✅ | ✅ |
| `text-muted` `#8b949e` | `surface` `#161b22` | **5.62** | ✅ | ✅ |
| `text-muted` `#8b949e` | `surface-raised` `#21262d` | **4.95** | ✅ | ✅ |

#### Dark theme — accent text/icons on `surface` `#161b22`

| Accent | Ratio | Normal text | Large/UI |
| --- | --- | --- | --- |
| `accent-success` `#3fb950` | **6.81** | ✅ | ✅ |
| `accent-failure` `#f85149` | **5.16** | ✅ | ✅ |
| `accent-warning` `#d29922` | **6.85** | ✅ | ✅ |
| `accent-info` `#58a6ff` | **6.85** | ✅ | ✅ |
| `accent-neutral` `#8b949e` | **5.62** | ✅ | ✅ |
| `accent-coral` `#f78166` | **6.83** | ✅ | ✅ |
| `accent-purple` `#a371f7` | **5.16** | ✅ | ✅ |
| `accent-gold` `#e3b341` | **8.89** | ✅ | ✅ |

(On `surface-raised` `#21262d` the same accents are 4.54–6.03 — all still ✅;
`accent-failure` is the floor at **4.54**.)

#### Dark theme — non-text UI (SC 1.4.11, need ≥3:1)

| Element | Ratio | Pass |
| --- | --- | --- |
| `focus` `#58a6ff` ring on `bg` | **7.49** | ✅ |
| `border-strong` `#6e7681` on `surface` | **3.77** | ✅ |
| `border` `#30363d` on `bg` | 1.55 | ❌ decorative only — never state |
| `border-strong` `#484f58` (rejected) on `surface` | 2.09 | ❌ — do not use; use `#6e7681` |
| accent bar (any status accent) on `surface` | ≥4.54 | ✅ |

#### Dark theme — solid-fill chips (text on a filled accent)

Solid accent fills can’t carry white text at AA, so **dark-theme status chips
use the tint pattern** (accent as text/icon/border over an `accent @ 10–14%`
tint of the surface) — never a solid fill with white text.

| Combination | Ratio | Verdict |
| --- | --- | --- |
| white `#ffffff` on `accent-failure` `#f85149` | 3.35 | ❌ — don’t fill red with white |
| `text` `#e6edf3` on `accent-failure` | 2.84 | ❌ |
| near-black `#0d1117` on `accent-success`/`warning`/`info` | 7.45 / 7.50 / 7.49 | ✅ if a solid fill is required, use near-black ink |
| near-black `#0d1117` on `accent-failure` | 5.65 | ✅ (red fill needs dark ink) |
| white on danger-emphasis `#da3633` | 4.61 | ✅ (only if a red solid fill with light ink is unavoidable) |

> **Rule:** prefer tinted chips everywhere in dark mode. The only solid fills are
> (a) the non-text accent bar, and (b) optional severity/health bar segments,
> which carry no text. Where a solid filled chip is unavoidable, ink it
> near-black `#0d1117`.

#### Light theme — text on surfaces

| Foreground | Background | Ratio | Normal text |
| --- | --- | --- | --- |
| `text` slate-900 `#0f172a` | white | **17.85** | ✅ |
| `text` slate-900 `#0f172a` | `surface-raised` slate-50 | **17.06** | ✅ |
| body slate-700 `#334155` | white | **10.35** | ✅ |
| `text-muted` slate-600 `#475569` | white | **7.58** | ✅ |
| slate-500 `#64748b` | white | 4.76 | ✅ (kept ≥4.5; **prefer slate-600** for muted body) |

#### Light theme — accent text on white

| Accent | Ratio | Normal text |
| --- | --- | --- |
| `accent-success` emerald-700 `#047857` | **5.48** | ✅ |
| `accent-failure` red-700 `#b91c1c` | **6.47** | ✅ |
| `accent-warning` amber-700 `#b45309` | **5.02** | ✅ |
| `accent-warning` amber-800 `#92400e` | **7.09** | ✅ (use 800 on tints) |
| `accent-info` sky-700 `#0369a1` | **5.93** | ✅ |
| sky-600 `#0284c7` | 4.10 | ❌ normal text — **use sky-700**; ok only as ≥3:1 UI |

#### Light theme — non-text UI & filled badges

| Element | Ratio | Pass |
| --- | --- | --- |
| `focus` sky-700 `#0369a1` ring on white | **5.93** | ✅ |
| sky-600 focus ring on white | 4.10 | ✅ as UI (≥3:1) but standardize on sky-700 |
| `border-strong` slate-500 `#64748b` on white | **4.76** | ✅ |
| slate-400 `#94a3b8` border on white | 2.56 | ❌ — fails SC 1.4.11, use slate-500+ |
| emerald-800 on emerald-100 chip | **6.78** | ✅ |
| red-800 on red-100 chip | **6.80** | ✅ |
| amber-900 on amber-100 chip | **8.15** | ✅ |
| rose-900 on rose-100 chip | **7.97** | ✅ |
| orange-800 on orange-100 chip | **6.38** | ✅ |

> The existing `*Cell` badge styles (emerald-/amber-/rose-/orange-100 tints with
> -800/-900 ink) already pass and are retained for the light table view (§6).

---

## 2. Status / icon system

**Invariant (carried over from every existing `*Cell`): never color alone.**
State is always encoded **redundantly** by **icon + color + text/`aria-label`**.
Color is the last, enhancing layer; remove it and the state is still legible.

### 2.1 Canonical status → color + glyph map

Derived from the Stream Deck `getStatusIcon` glyph set
(`button-renderer.ts` lines 89–119) and the existing cells. Glyphs ship as inline
SVG primitives (`StatusGlyph`, §5) so they scale crisply on large tiles.

| Status | Token | Glyph (shape) | Text label | Used by |
| --- | --- | --- | --- | --- |
| success / passing / healthy | `accent-success` | ✓ checkmark polyline | “Passing” / “Healthy” / “Clear” | CI, Security, Fleet |
| failure / error / critical | `accent-failure` | ✗ cross | “Failing” / “Critical” / “Down” | CI, Security, Fleet |
| in_progress / running | `accent-warning` | ◓ arc + arrowhead (spinner when animated) | “Running” | CI |
| queued / pending | `accent-info` | ◷ clock-start | “Queued” | CI |
| warning / degraded / over-threshold | `accent-warning` | △ triangle-bang | “Warning” / “Over threshold” | Issues, Security C |
| stale / inactive | `accent-warning` | ◷ clock | “Stale” | Stale |
| neutral / none / skipped | `accent-neutral` | — minus line | “No runs” / “None” | CI, all empty states |
| new-contributor / external | `accent-coral` | ★ star | “External” | Pull requests |
| review-requested | urgency scale (§4.4): `accent-info` → `accent-warning` → `accent-failure` | ◉ eye / target | “Awaiting you” | Reviews |
| loading | `accent-neutral` | skeleton shimmer or spinner | sr-only “Loading…” | all |
| unknown / no-access | `accent-neutral` | — / “n/a” | “Unavailable” | all |

The exact SVG path data for ✓ ✗ spinner clock △ may be lifted from
`button-renderer.ts` `STATUS_ICONS` (read-only reference) or the existing cell
SVGs; both are MIT/owned by us.

### 2.2 Animation & ambient glow — reduced-motion

The Stream Deck UI uses an animated spinner (`renderAnimatedSpinner`) and an
**ambient status glow** (a low-opacity flat fill that tints the whole strip the
status color — `renderWorkflowStrip`: `fill-opacity 0.06`). We scale the glow up
as an optional tile treatment (§4.1 CI) and the spinner for loading.

**`prefers-reduced-motion: reduce` requirements (WCAG 2.3.3 / 2.2.2):**

- The global rule already neutralizes CSS animation/transition durations
  (`src/index.css`). Keep it; do not regress it.
- The loading **spinner must not spin** under reduced motion — swap the rotating
  arc for a **static skeleton/pulse-free placeholder** (mirror the existing
  `motion-reduce:animate-none` skeletons in the cells).
- The **ambient glow is static** (a fixed low-opacity tint, never a pulsing
  “breathe”). If a pulse is ever added, gate it behind
  `motion-safe:` so reduced-motion users get the static tint.
- Any sparkline/heatmap **draw-in** transition must be `motion-safe:` only;
  reduced-motion renders the final frame immediately.

---

## 3. Web tile anatomy (shared)

The shared frame (`TileFrame`, §5) scales the 144×144 Stream Deck key anatomy —
top accent bar → identifier line → hero value/glyph → metadata line — up to a
flexible, resizable card. All tiles share this skeleton; only the **body** is
signal-specific.

### 3.1 Regions

```
┌──────────────────────────────────────────────┐
│ ▔▔▔▔▔▔▔▔▔▔▔▔ accent bar (top, 3–4px) ▔▔▔▔▔▔▔▔ │ ← status/identity accent (non-text)
│ ┌────────────────────────────┬─────────────┐ │
│ │ repo/owner (text-muted)     │ SIGNAL ⬩ ●  │ │ ← HEADER: repo (truncate) + signal label + status dot
│ ├────────────────────────────┴─────────────┤ │
│ │                                            │ │
│ │            BODY (signal-specific)          │ │ ← hero glyph / big value / gauge / sparkline
│ │      glyph + big value + redundant text    │ │
│ │                                            │ │
│ ├────────────────────────────────────────────┤ │
│ │ meta / last-updated · deep-link (footer)   │ │ ← FOOTER: metadata, optional external link
│ └────────────────────────────────────────────┘ │
│ [edit-mode control rail: ← → ↑ ↓ +W −W +H −H ] │ ← only in edit mode (see §3.5)
└──────────────────────────────────────────────┘
```

### 3.2 Accent treatment

- **Move the accent from a 4px left band to a top bar** matching the Stream Deck
  anatomy (`<rect width=144 height=6>` → our `h-1` / 3–4px full-width bar at the
  card’s top, inside the rounded corners). The bar color is the tile’s resolved
  accent (§1.4) and is **non-text** decoration — never the sole status cue (the
  status dot + glyph + text in the body carry it).
- Retain the lifecycle hint (loading/error/ready) the current left band encodes,
  but fold it into the accent bar color + the `data-status` attribute that
  already exists on the `<article>` (keep `data-status` — tests and the roving
  grid rely on it).

### 3.3 Header

- **Repo** (`repo.nameWithOwner`, truncated with `title=`) in `text-muted`,
  small. **Signal label** (`SIGNAL_LABELS[signal]`) uppercase tracking-wide in
  `text-muted`, plus a small **status dot** (`accent-*`) that duplicates the
  accent bar for at-a-glance scanning. Dot is `aria-hidden`; the
  `aria-label`/sr-text carries the status word.

### 3.4 Size-responsive rules

Tiles measure their own rendered size (a `ResizeObserver`-backed
`useTileSize` hook, or react-grid-layout’s `w`/`h` units passed down) and pick a
density. **Three tiers**, keyed off width × height in grid units:

| Tier | Trigger (approx) | Body content |
| --- | --- | --- |
| **Compact** | `w ≤ 2` or `h ≤ 1` (≈ ≤181px wide / ≤96px tall) | Hero glyph **or** big value + one-line label. No sparkline/gauge. Footer hidden. This is the closest analog to the 144px Stream Deck key. |
| **Standard** (default) | `w 3–4, h 2–3` | Glyph/value + secondary detail (counts, mini-list, small gauge/sparkline) + footer meta. |
| **Expanded** | `w ≥ 5` or `h ≥ 4` | Full visual (large arc gauge / full sparkline + heatmap / multi-row breakdown) + footer with deep link and last-updated. |

Rules:
- Never show a visual that needs more than ~120px of a dimension in a tier that
  can’t supply it; **degrade to the next-simpler representation** (heatmap →
  sparkline → big number → glyph).
- Text never truncates the _meaning_: the big value and status word are the last
  things dropped. Decorative sub-labels drop first.
- Hit target for the whole-tile activate overlay stays ≥24×24px (it already fills
  the card). Edit-mode controls stay ≥28px (`h-7`).

### 3.5 Edit-mode controls

Unchanged behavior from today: in edit mode the active tile exposes the activate
overlay + 8 Move/Resize buttons (`TileControls` in `SignalTile.tsx`). Restyle
only: control buttons use `surface` bg, `text` ink, **`border-strong`** outline
(replacing today’s failing `slate-300`), and the `focus` ring token. Persistently
visible resize handles (the `.dashboard-editing` rule in `index.css`) move from
the hard-coded `#475569` stroke to `border-strong` so they track the theme
(dark needs a light handle, not a slate one).

### 3.6 States (every tile)

- **Loading:** accent bar `accent-neutral`; body shows the §2.2 reduced-motion-
  aware spinner/skeleton; sr-only “Loading {signal}…”.
- **Error:** accent bar `accent-failure` (muted); body shows ✗/— glyph + “Couldn’t
  load {signal}”, with a retry affordance where the data hook supports it.
- **Empty / all-clear:** accent bar `accent-success` or `accent-neutral`; body
  shows the positive empty state (e.g. ✓ “No open alerts”), never a blank card.
- **Unknown / no-access:** `accent-neutral`; “Unavailable” / “n/a” with the
  explanatory `title`/sr-text the cells already provide.

---

## 4. Per-signal tile specs

Each spec lists: **data**, **primary visual**, **tokens**, **redundant
encoding**, and **states**. Visuals reference §5 primitives. Tier behavior
follows §3.4. The underlying slice types are in `src/types/fleet.ts`.

### 4.1 CI / Actions

- **Data** (`CiSignalSlice`): `conclusion` (success | failure | in_progress |
  queued | none), `failingCount`, `latestRunUrl`.
- **Primary visual:** large **`StatusGlyph`** (✓/✗/spinner/clock/—) in the run’s
  status accent, centered, with an optional **ambient glow** (`AmbientGlow`,
  static tint of the surface in the status color at ~6–8% — the scaled-up
  `renderWorkflowStrip` treatment). Below it, the status word as `BigValue`
  (“Passing”/“Failing”) and, when failing, `failingCount` (“2 workflows
  failing”). Expanded tier adds a **run-history dot row** (recent runs,
  newest-first, leading dot ringed — from `renderWorkflowStrip` dots) and the
  run duration/relative time.
- **Tokens:** glyph + glow + accent bar = status accent (success/failure/warning/
  info/neutral per §2.1). Text `text`; meta `text-muted`.
- **Redundant encoding:** glyph **and** status word **and** color **and**
  `aria-label` (“CI failing — 2 workflows”). Glow is purely additive.
- **Deep link:** “View latest run” in the footer → `latestRunUrl`, **origin-gated
  to GitHub** exactly as `CiCell.isGitHubUrl` / `safeGitHubHref` does today.
- **States:** loading → spinner (static under reduced-motion); none → — “No runs”;
  error → ✗ “Couldn’t load CI”.

### 4.2 Security

- **Data** (`SecuritySignalSlice`): `grade` (A–F), `counts`
  `{critical, high, medium, low}`, `truncated`.
- **Primary visual:** an **`ArcGauge`** (semicircular, scaled from
  `renderSecurityArcStrip`) with the **letter grade** as the hero in the arc
  center, plus **`SeverityBar`** breakdown bars (or the Stream Deck severity-dot
  legend at compact sizes). The arc fill proportion = security score; color steps
  green→amber→red by grade.
- **Grade/score source of truth:** use the **local**
  `computeGrade` / `computeSecurityScore` in
  `src/hooks/signals/securityGrade.ts` (A none; B low 1–9; C many low/light
  medium; D heavy medium/high 1–2; E high ≥3; F any critical). **Do not** import
  the Stream Deck plugin’s slightly different rubric — keep one grader.
- **Tokens:** grade A–B → `accent-success`; C → `accent-warning`; D–F →
  `accent-failure`. Severity bars: critical `accent-failure`, high
  `accent-warning`, medium `accent-info`, low `accent-neutral`.
- **Redundant encoding:** the **letter carries the meaning** (never color-only —
  preserves the `GRADE_BADGE_CLASS` principle); severity bars are each labelled
  (`C2 H1 …`) with sr-text; the `truncated` partial state shows the “≥” prefix +
  “partial” pill + sr “(partial — more alerts not counted)” exactly as
  `SecurityCell` does today.
- **States:** all-clear (grade A) → ✓ “No open alerts”; `counts` absent →
  “n/a — no security-alert access”; loading/error per §3.6.

### 4.3 Pull requests

- **Data** (`PullRequestsSignalSlice`): `openCount`, `externalCount`. (Oldest /
  blocked mini-list is a **future** enrichment — design the slot now; render it
  only when the slice gains the fields, otherwise omit.)
- **Primary visual:** `BigValue` open-PR count with the PR `StatusGlyph` (the
  branch icon from `PullRequestsCell`). When `externalCount > 0`, a prominent
  **new-contributor `Chip`** (`accent-coral`, ★ glyph, “N external”). Expanded
  tier reserves a **mini-list** region for oldest/blocked PRs (title + age),
  rendered when data is available.
- **Tokens:** identity accent `accent-info`; external highlight `accent-coral`
  (light: orange-800 ink on orange-100 tint — the existing badge; dark: coral
  text/border on coral tint).
- **Redundant encoding:** count text + PR glyph; external chip = ★ icon + word
  “external” + sr “from new outside contributors” + hover title (carried from
  `PullRequestsCell`).
- **States:** `0/0` → — “No open pull requests”; loading skeleton; error → —
  “Pull request data unavailable”.

### 4.4 Reviews

- **Data** (`ReviewsSignalSlice`): `requestedCount` (open PRs awaiting the
  viewer).
- **Primary visual:** **urgency-emphasized** `BigValue` count + eye `StatusGlyph`.
  Urgency scales the accent (mirrors the Stream Deck PR-queue thresholds
  blue→amber→red): `0` neutral/clear · `1–2` info · `3–4` warning · `5+` failure
  emphasis. The count sits in an emphasized `Chip` when `> 0` (“N awaiting you”).
- **Tokens:** `0` → `accent-neutral`; escalating per the thresholds above
  (`accent-info` → `accent-warning` → `accent-failure`). The “awaiting you” chip
  is tinted by the active urgency accent in both themes via the §1.5 accent-tint
  pattern — semantic tokens only, never a raw `rose-*` / hard-coded colour.
- **Redundant encoding:** eye icon + “awaiting you” text + sr-label
  (“N pull requests awaiting your review”). Urgency never rests on color — the
  count itself and the word convey it.
- **States:** `0` → — “None awaiting your review”; loading; error → — “Review
  queue unavailable”.

### 4.5 Issues

- **Data** (`IssuesSignalSlice`): `openCount`, `overThreshold`.
- **Primary visual:** `BigValue` open-issue count with the issue `StatusGlyph`;
  when `overThreshold`, append the **triage `△` glyph** + “over triage threshold”
  in `accent-warning`.
- **Tokens:** default `accent-neutral`; over-threshold `accent-warning`
  (light amber-800 ink, dark `#d29922`).
- **Redundant encoding:** count text + issue icon; over-threshold = triangle-bang
  icon **and** the words **and** color, with the `aria-label`
  (“N open issues, over the triage threshold”) from `IssuesCell`.
- **States:** `0` → — “No open issues” (or “0 open”); loading; error → —
  “Issue count unavailable”.

### 4.6 Stale

- **Data** (`StaleSignalSlice`): `staleCount`; threshold
  `STALE_THRESHOLD_DAYS` (`useStaleSignal.ts`).
- **Primary visual:** clock `StatusGlyph` + `BigValue` stale-item count, with the
  **staleness duration** spelled out (“no activity in {STALE_THRESHOLD_DAYS}
  days”). Expanded tier can show a small bar of oldest-item age if the slice
  later carries per-item ages.
- **Tokens:** `0` → `accent-neutral`; `> 0` → `accent-warning` (light amber chip,
  dark warning tint).
- **Redundant encoding:** clock icon + “N stale” text + sr-label
  (“N open items with no activity in N days”) per `StaleCell`.
- **States:** `0` → — “Nothing stale”; loading; error → — “Stale activity
  unavailable”.

### 4.7 Activity (NEW)

The new tile. No existing `*Cell` — fully bespoke. Mirrors the Stream Deck
`commit-activity` (sparkline) and `contribution-heatmap` (weeks × days) visuals.

- **Data** (new slice — define `ActivitySignalSlice` in `types/fleet.ts` via the
  downstream signal task): `weeklyTotals: number[]` (per-week commit counts, most
  recent last) for the **sparkline**, and `dailyByWeek: number[][]`
  (weeks × 7 days) for the **heatmap**, plus `totalCommits`. Shapes match
  `renderHeatmapStrip(weeklyData, …)` and the `commit-activity` `weeks[].total`
  trend.
- **Primary visual:**
  - **Compact:** `Sparkline` of `weeklyTotals` (last ~8 weeks) + the total commit
    `BigValue`.
  - **Standard:** sparkline + total + “last N weeks”.
  - **Expanded:** **`Heatmap`** (weeks × 7 days, M–S rows, intensity = commits/day
    scaled to the max, empty cell distinct) **plus** the sparkline and a summary
    panel (total + weeks count) — the scaled-up touch-strip heatmap.
- **Tokens:** ink `accent-success` (`#3fb950` dark / emerald-700 light); empty
  heatmap cell = a faint `surface-raised`-derived tone (dark `#0a0f14`-equivalent
  via a low-opacity success tint over surface; light a slate-100 cell). Sparkline
  area fill = `accent-success` at low opacity; endpoint dot = solid
  `accent-success`.
- **Redundant encoding:** the heatmap is **not** color-only — each cell exposes
  its count via `<title>`/sr-text (“{n} commits on {date}”), the sparkline has an
  sr-only summary (“{total} commits over {n} weeks, trend up/down”), and the big
  number states the total. Intensity is reinforced by the numeric tooltip, not
  hue alone. Provide an accessible table fallback (sr-only) of weekly totals.
- **States:** no commits → flat sparkline + “No recent commit activity”; loading
  skeleton (no shimmer under reduced-motion); error → — “Activity unavailable”.

### 4.8 Fleet summary

- **Data** (`FleetHealthSummary`, `src/lib/fleet-summary.ts`): `total`,
  `broken`, `warning`, `healthy`, plus per-signal rollups (`failingCi`,
  `securityRisk`, `issuesOverThreshold`, `reviewRequested`, `staleRepos`).
- **Primary visual:** a **health-split bar** (`SeverityBar`/stacked bar) showing
  broken/warning/healthy proportions of `total`, with the counts labelled, plus
  the non-zero **per-signal rollup** chips below. This replaces today’s plain
  text line with a glanceable split (scaled from the Stream Deck `fleet-monitor`
  rollup idea). Remains pinned and non-resizable (not a grid item).
- **Tokens:** broken segment `accent-failure`, warning `accent-warning`, healthy
  `accent-success`; rollup chips use each signal’s accent.
- **Redundant encoding:** every segment keeps its **icon (✗ / ! / ✓) + count +
  word** (“N need attention”, “N warning”, “N healthy”) — the existing
  `HEALTH_STATS` icon+text pattern — so the split is legible without color. Each
  bar segment is also a labelled `<title>`/sr region.
- **States:** empty fleet → “0 repos”; otherwise always renders (no loading state
  — it’s derived client-side from already-loaded slices).

---

## 5. Shared primitive inventory

New presentational primitives the redesign builds under
`src/components/tiles/` (table atoms stay in `columns/`, §6). All are theme-aware
(consume semantic tokens), AA, and accept a `tone` that resolves to an accent
variable — never a raw hex.

| Primitive | Purpose | Prop sketch |
| --- | --- | --- |
| `TileFrame` | Shared card shell: accent bar + header + body slot + footer + `data-status`, the activate overlay, edit controls. Replaces the bespoke markup in `SignalTile`. | `{ repo: Repo; signalLabel: string; tone: AccentTone; status: SignalStatus; size: TileTier; footer?: ReactNode; children: ReactNode; …rovingTabindex/edit props from today }` |
| `AccentBar` | Top status/identity bar (non-text). | `{ tone: AccentTone; thickness?: 'sm' \| 'md' }` |
| `StatusGlyph` | Inline SVG status icon (✓ ✗ spinner clock △ — ★ eye), colorized via `currentColor`/token. | `{ status: SignalIconKind; size?: number; title?: string }` |
| `StatusDot` | Small accent dot in the header, `aria-hidden`. | `{ tone: AccentTone }` |
| `BigValue` | Hero number/word with dynamic font-size to fit (the Stream Deck `line2FontSize` idea). | `{ value: ReactNode; sub?: string; tone?: AccentTone; size?: TileTier }` |
| `Chip` | Tinted pill (count/highlight) with icon + text; tint pattern in dark, -100/-800 badge in light. | `{ tone: AccentTone; icon?: ReactNode; children: ReactNode; title?: string; srLabel?: string }` |
| `SeverityBar` | Stacked/segmented horizontal bar (security severities, fleet health split). Each segment labelled. | `{ segments: { tone: AccentTone; value: number; label: string }[]; max?: number }` |
| `ArcGauge` | Semicircular gauge (security score) with a centered hero (grade). Scaled from `renderSecurityArcStrip`. | `{ value: number; max?: number; tone: AccentTone; center: ReactNode; srLabel: string }` |
| `Sparkline` | Smooth area sparkline (commit weekly totals) with endpoint dot + sr summary. Scaled from `sparklinePath`/`sparklineAreaPath`. | `{ data: number[]; tone?: AccentTone; srLabel: string; width?: number; height?: number }` |
| `Heatmap` | Weeks × 7-day contribution grid; intensity by count; per-cell `<title>`; sr table fallback. Scaled from `renderHeatmapStrip`. | `{ weeks: number[][]; tone?: AccentTone; max?: number; srLabel: string }` |
| `AmbientGlow` | Static low-opacity status tint behind a tile body (CI). `motion-safe` only if ever animated. | `{ tone: AccentTone; opacity?: number }` |

The spinner/skeleton for loading is a `StatusGlyph status="loading"` variant that
honors `prefers-reduced-motion` (§2.2).

---

## 6. Mapping note — what stays vs. what becomes bespoke

The **table view is unchanged** by this redesign — it keeps using the compact
`*Cell` atoms; those will only be **recolored** to dark tokens by the later
theme task (their light badges already pass AA, §1.5).

| Existing `*Cell` (`src/components/columns/`) | Table view | Tile view |
| --- | --- | --- |
| `CiCell` | **stays** (dark-recolor later) | replaced by bespoke CI body (`StatusGlyph` + `BigValue` + `AmbientGlow`) |
| `SecurityCell` | **stays** | replaced by `ArcGauge` + `SeverityBar` (grade/score from the shared `securityGrade` helper) |
| `PullRequestsCell` | **stays** | replaced by `BigValue` + external `Chip` (+ future mini-list) |
| `ReviewsCell` | **stays** | replaced by urgency `BigValue` + `Chip` |
| `IssuesCell` | **stays** | replaced by `BigValue` + triage `StatusGlyph` |
| `StaleCell` | **stays** | replaced by `BigValue` + clock + duration text |
| (none) Activity | n/a (no table column) | **new** `Sparkline` + `Heatmap` body |
| `FleetSummaryTile` | n/a | **reworked** to a health-split `SeverityBar` + rollup chips |

Implication for `SignalTile.tsx`: it stops calling `SignalSummary`/the `*Cell`
atoms and instead renders `TileFrame` with a per-signal body component. The
`data-status`, roving-`tabindex`, `aria-colindex/rowindex`, activate-overlay, and
`TileControls` behavior are **preserved** — only the visual body and styling
tokens change. The grading/scoring and URL-safety helpers
(`securityGrade.ts`, `github-url.ts` / `isGitHubUrl`) are reused, not duplicated.

---

## 7. Downstream task hand-off

| Token / decision | Consumed by |
| --- | --- |
| §1 semantic tokens + `darkMode:'class'` + CSS-variable mapping | `theme-tokens` task (edits `tailwind.config.js`, `src/index.css`, adds `useTheme`) |
| §1.5 contrast table | every component PR (the AA budget to not regress) |
| §2 status map + reduced-motion rules | `StatusGlyph` / animation PRs |
| §3 `TileFrame` anatomy + size tiers | `tile-frame` task (refactors `SignalTile`) |
| §4 per-signal bodies | one PR per signal (CI, Security, PRs, Reviews, Issues, Stale, **Activity**, FleetSummary) |
| §4.7 `ActivitySignalSlice` shape | the new Activity **signal hook** task (data) + Activity tile task (view) |
| §5 primitive inventory | `tiles/` primitive PRs (build before the per-signal bodies depend on them) |
| §6 mapping | guarantees the table view + `*Cell` atoms are untouched except recolor |

> **Constraint reminder for implementers:** client-only (no backend), validate
> every GitHub API response with Zod, secrets never touch the bundle, all new
> components AA per §1.5, and `DrillDownDrawer` stays dark.
