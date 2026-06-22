import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardLayout } from '../hooks/useDashboardLayout';
import { parseColorTokens } from '../lib/css-tokens';
import { DEFAULT_LAYOUT } from '../lib/dashboard-layout';
import type { GetRowData, Repo } from '../types/fleet';
import { DashboardView as DashboardViewImpl } from './DashboardView';

// Activity tiles self-fetch via `useCommitActivity` (which reads the auth
// context); stub it so the full grid mounts without an AuthProvider or network.
vi.mock('../hooks/useCommitActivity', () => ({
  useCommitActivity: vi.fn(() => ({ state: 'empty' })),
}));

// The layout hook was lifted to the parent (App) in Phase 3 (C1), so the view
// now takes `layout`/`onLayoutChange` as props. This wrapper restores the prior
// self-contained behavior for these tests by calling the real hook — identical
// localStorage load/persist semantics — so existing assertions stand unchanged.
function DashboardView(
  props: Omit<ComponentProps<typeof DashboardViewImpl>, 'layout' | 'onLayoutChange'>,
): ReactElement {
  const { layout, setLayout } = useDashboardLayout(props.repos);
  return <DashboardViewImpl {...props} layout={layout} onLayoutChange={setLayout} />;
}

const STORAGE_KEY = 'fleet:dashboard-layout';

// The set of `--color-*` custom properties actually declared in src/index.css
// (light `:root` block). Used by the error-alert test to prove every
// `var(--color-*)` the alert references resolves to a DEFINED token — the prior
// substring assertions passed identically whether the arbitrary `color-mix()`
// tint referenced a defined token (`var(--color-failure)`) or an undefined one
// (`var(--color-accent-failure)`), the exact regression that shipped green in
// #209 and was caught only by building the bundle (#210).
const indexCss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'),
  'utf8',
);
const DEFINED_COLOR_VARS = new Set(Object.keys(parseColorTokens(indexCss, ':root')));

/** Every `var(--color-NAME)` referenced inside a (possibly arbitrary-value) className. */
function referencedColorVars(className: string): string[] {
  return [...className.matchAll(/var\(\s*(--color-[\w-]+)\s*\)/g)].map((match) => match[1]);
}

function makeRepo(nameWithOwner: string): Repo {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate: false };
}

const emptyData: GetRowData = () => ({});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('DashboardView', () => {
  it('renders an accessible dashboard region', () => {
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
      />,
    );
    expect(screen.getByRole('region', { name: /dashboard/i })).toBeInTheDocument();
  });

  it('renders one tile per visible signal for each repo', () => {
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
      />,
    );
    // Seven per-repo signals → seven tiles for a single repo.
    expect(screen.getAllByRole('button', { name: /: .*octo\/a/i })).toHaveLength(7);
  });

  it('passes per-repo signal data through to its tiles', () => {
    const getRowData: GetRowData = (repo) =>
      repo.nameWithOwner === 'octo/a' ? { ci: { status: 'ready', conclusion: 'failure' } } : {};
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={getRowData}
        onRepoActivate={vi.fn()}
      />,
    );
    // Exactly twice for the single failing CI tile: the StatusGlyph's accessible
    // <title> (role="img") + the visible BigValue span. Pinning the count guards
    // against silently dropping the visible hero value (#193).
    expect(screen.getByRole('img', { name: 'Failing' })).toBeInTheDocument();
    expect(screen.getAllByText('Failing')).toHaveLength(2);
  });

  it('calls onRepoActivate when a tile is activated (opens the drill-down)', async () => {
    const onRepoActivate = vi.fn();
    const repo = makeRepo('octo/a');
    const user = userEvent.setup();
    render(<DashboardView repos={[repo]} getRowData={emptyData} onRepoActivate={onRepoActivate} />);
    await user.click(screen.getAllByRole('button', { name: /: .*octo\/a/i })[0]);
    expect(onRepoActivate).toHaveBeenCalledWith(repo);
  });

  it('shows an empty state when there are no repos', () => {
    render(<DashboardView repos={[]} getRowData={emptyData} onRepoActivate={vi.fn()} />);
    expect(screen.getByText(/no repositories to display/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /: .*\u2014 octo/i })).toBeNull();
  });

  it('does not render hidden tiles', () => {
    const repos = [makeRepo('octo/a')];
    const hidden = DEFAULT_LAYOUT(repos).map((tile) => ({ ...tile, visible: false }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden));
    render(<DashboardView repos={repos} getRowData={emptyData} onRepoActivate={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /: .*\u2014 octo/i })).toBeNull();
    expect(screen.getByText(/all tiles hidden/i)).toBeInTheDocument();
  });

  it('renders a static, non-draggable grid by default (not editing)', () => {
    const { container } = render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
      />,
    );
    const item = container.querySelector('.react-grid-item');
    expect(item).not.toBeNull();
    // Without edit mode the grid item is neither draggable nor actively resizable.
    expect(item).not.toHaveClass('react-draggable');
    expect(item).toHaveClass('react-resizable-hide');
  });

  it('enables drag + resize on the grid items when editing', () => {
    const { container } = render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        editing
      />,
    );
    const item = container.querySelector('.react-grid-item');
    expect(item).not.toBeNull();
    expect(item).toHaveClass('react-draggable');
    // The resize handle is no longer hidden, and the editing affordance class is set.
    expect(item).not.toHaveClass('react-resizable-hide');
    expect(container.querySelector('.dashboard-editing')).not.toBeNull();
    expect(container.querySelector('.react-resizable-handle')).not.toBeNull();
  });

  it('keeps tiles keyboard-activatable while editing', async () => {
    const onRepoActivate = vi.fn();
    const repo = makeRepo('octo/a');
    const user = userEvent.setup();
    render(
      <DashboardView
        repos={[repo]}
        getRowData={emptyData}
        onRepoActivate={onRepoActivate}
        editing
      />,
    );
    await user.click(screen.getAllByRole('button', { name: /: .*octo\/a/i })[0]);
    expect(onRepoActivate).toHaveBeenCalledWith(repo);
  });

  it('uses CSS transforms for positioning when motion is allowed', () => {
    const { container } = render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
      />,
    );
    const item = container.querySelector('.react-grid-item') as HTMLElement | null;
    expect(item?.getAttribute('style')).toContain('transform');
  });

  it('disables CSS transform animation when the user prefers reduced motion', () => {
    const matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('matchMedia', matchMedia);
    try {
      const { container } = render(
        <DashboardView
          repos={[makeRepo('octo/a')]}
          getRowData={emptyData}
          onRepoActivate={vi.fn()}
        />,
      );
      const item = container.querySelector('.react-grid-item') as HTMLElement | null;
      const style = item?.getAttribute('style') ?? '';
      expect(style).not.toContain('transform');
      // Falls back to top/left positioning instead.
      expect(style).toContain('top');
      expect(style).toContain('left');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders the pinned fleet summary above the grid', () => {
    render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
      />,
    );
    const summary = screen.getByRole('region', { name: /fleet summary/i });
    expect(summary).toBeInTheDocument();
    // The summary is not a draggable grid tile — it lives outside the grid.
    expect(summary.closest('.react-grid-item')).toBeNull();
  });

  it('reflects the fleet health in the summary', () => {
    const getRowData: GetRowData = (repo) =>
      repo.nameWithOwner === 'octo/a' ? { ci: { status: 'ready', conclusion: 'failure' } } : {};
    render(
      <DashboardView
        repos={[makeRepo('octo/a'), makeRepo('octo/b')]}
        getRowData={getRowData}
        onRepoActivate={vi.fn()}
      />,
    );
    const summary = screen.getByRole('region', { name: /fleet summary/i });
    expect(summary).toHaveTextContent('2 repos');
    expect(within(summary).getByText(/1\s+need attention/i)).toBeInTheDocument();
  });

  it('feeds per-repo health entries into the fleet summary (strip + worst-child)', () => {
    const getRowData: GetRowData = (repo) =>
      repo.nameWithOwner === 'octo/a' ? { ci: { status: 'ready', conclusion: 'failure' } } : {};
    render(
      <DashboardView
        repos={[makeRepo('octo/a'), makeRepo('octo/b')]}
        getRowData={getRowData}
        onRepoActivate={vi.fn()}
      />,
    );
    const summary = screen.getByRole('region', { name: /fleet summary/i });
    // The per-repo strip has one cell per repo (entries derived from repoData).
    const strip = summary.querySelector('[data-part="repo-strip"]');
    expect(strip?.querySelectorAll('[data-health]')).toHaveLength(2);
    // The worst-child chip names the broken repo.
    const worstChild = summary.querySelector('[data-part="worst-child"]');
    expect(worstChild).toHaveTextContent('octo/a');
  });

  it('still renders the fleet summary in the empty state', () => {
    render(<DashboardView repos={[]} getRowData={emptyData} onRepoActivate={vi.fn()} />);
    expect(screen.getByText(/no repositories to display/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /fleet summary/i })).toBeInTheDocument();
  });

  it('shows a reduced-motion-friendly loading skeleton while repos load', () => {
    const { container } = render(
      <DashboardView repos={[]} getRowData={emptyData} onRepoActivate={vi.fn()} loading />,
    );
    // Announces loading and marks the region busy for assistive tech.
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    // Decorative pulse placeholders that respect prefers-reduced-motion.
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBeGreaterThan(0);
    pulses.forEach((pulse) => expect(pulse).toHaveClass('motion-reduce:animate-none'));
    // The empty-state copy must NOT flash while loading.
    expect(screen.queryByText(/no repositories to display/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /: .*\u2014 octo/i })).toBeNull();
  });

  it('paints the loading-skeleton placeholders with the shared border token', () => {
    const { container } = render(
      <DashboardView repos={[]} getRowData={emptyData} onRepoActivate={vi.fn()} loading />,
    );
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBeGreaterThan(0);
    // The decorative skeleton uses the shared `bg-border` token (slate-200 in
    // light, like every other skeleton in the app) instead of the fainter
    // surface-raised slate-50, so the light hue is exact and it still flips dark.
    pulses.forEach((pulse) => {
      expect(pulse.className).toContain('bg-border');
      expect(pulse.className).not.toContain('bg-surface-raised');
    });
  });

  it('renders an alert with a retry control when the fetch fails', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <DashboardView
        repos={[]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        error="Could not load your dashboard."
        onRetry={onRetry}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load your dashboard.');
    // Never strands the user on the empty state when there is an error.
    expect(screen.queryByText(/no repositories to display/i)).toBeNull();

    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('colors the fleet-load error alert with dark-safe semantic failure tokens', () => {
    render(
      <DashboardView
        repos={[]}
        getRowData={emptyData}
        onRepoActivate={vi.fn()}
        error="Could not load your dashboard."
        onRetry={vi.fn()}
      />,
    );

    // The alert must rely on themed failure tokens, never hardcoded red-* palette
    // classes that render light-red (and fail AA) on the dark theme.
    const alert = screen.getByRole('alert');
    expect(alert.className).not.toMatch(/\b(border|bg|text|outline)-red-\d/);
    expect(alert.className).toContain('text-accent-failure');

    // The Retry control uses the same semantic failure ink and the app-wide focus ring.
    const retry = screen.getByRole('button', { name: /retry/i });
    expect(retry.className).toContain('text-accent-failure');
    expect(retry.className).toContain('outline-focus');
    expect(retry.className).not.toMatch(/-red-\d/);

    // STRENGTHEN (#210): the substring assertions above pass even if an arbitrary
    // `color-mix(...)` tint references an UNDEFINED custom property (e.g.
    // `var(--color-accent-failure)` instead of the defined `var(--color-failure)`),
    // which renders inert — transparent bg / currentColor border — yet keeps every
    // asserted class string intact. jsdom can't resolve the compiled CSS, so we
    // cross-check statically: every `var(--color-*)` the alert + retry reference
    // must be DECLARED in src/index.css.
    const referenced = [
      ...referencedColorVars(alert.className),
      ...referencedColorVars(retry.className),
    ];
    // Teeth: the alert's color-mix tints DO reference custom properties, so an
    // empty set would mean the styling (or the regex) silently changed.
    expect(referenced.length).toBeGreaterThan(0);
    for (const name of referenced) {
      expect(
        DEFINED_COLOR_VARS.has(name),
        `${name} is referenced by the error alert but is not declared in src/index.css`,
      ).toBe(true);
    }
  });

  it('prefers the error state over the empty state even with no repos', () => {
    render(
      <DashboardView repos={[]} getRowData={emptyData} onRepoActivate={vi.fn()} error="boom" />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/no repositories to display/i)).toBeNull();
  });

  it('computes each repo signal data once per render (no per-tile recomputation)', () => {
    const getRowData = vi.fn<GetRowData>(() => ({}));
    render(
      <DashboardView
        repos={[makeRepo('octo/a'), makeRepo('octo/b')]}
        getRowData={getRowData}
        onRepoActivate={vi.fn()}
      />,
    );
    // Two repos → seven tiles each. Data must be resolved once per repo, not per tile.
    const uniqueRepos = new Set(getRowData.mock.calls.map(([repo]) => repo.nameWithOwner));
    expect(uniqueRepos.size).toBe(2);
    expect(getRowData).toHaveBeenCalledTimes(2);
  });
});

describe('DashboardView — density wiring (T15)', () => {
  const failingCi: GetRowData = (repo) =>
    repo.nameWithOwner === 'octo/a' ? { ci: { status: 'ready', conclusion: 'failure' } } : {};

  it('renders standard-tier micro-viz under the default (balanced) density', () => {
    const { container } = render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={failingCi}
        onRepoActivate={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-shape]')).not.toBeNull();
  });

  it('drops standard-tier micro-viz when the persisted density is glanceable', () => {
    localStorage.setItem('fleet:density', 'glanceable');
    const { container } = render(
      <DashboardView
        repos={[makeRepo('octo/a')]}
        getRowData={failingCi}
        onRepoActivate={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-shape]')).toBeNull();
  });
});
