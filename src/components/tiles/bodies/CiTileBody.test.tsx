import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CiSignalSlice, Repo, RepoSignalData } from '../../../types/fleet';
import type { TileTier } from '../types';

import { CiTileBody } from './CiTileBody';

const repo: Repo = {
  nameWithOwner: 'octocat/hello-world',
  owner: 'octocat',
  name: 'hello-world',
  isPrivate: false,
};

function data(ci?: CiSignalSlice): RepoSignalData {
  return { ci };
}

/** Find the StatusGlyph svg by its data-status attribute. */
function glyph(container: HTMLElement, status: string): Element | null {
  return container.querySelector(`svg[data-status="${status}"]`);
}

/**
 * A fixed reference instant for relative-time assertions. `formatRelativeTime`
 * reads the real clock (`new Date()`), so the recency tests freeze `Date` here
 * to remove the ~5-min-boundary flake (#273).
 */
const FIXED_NOW = new Date('2024-01-15T12:00:00Z');

afterEach(() => {
  vi.useRealTimers();
});

describe('CiTileBody', () => {
  it('exports a named CiTileBody component', () => {
    expect(typeof CiTileBody).toBe('function');
  });

  describe('conclusion → glyph + tone + word (standard tier)', () => {
    const cases: ReadonlyArray<[NonNullable<CiSignalSlice['conclusion']>, string, string, string]> =
      [
        ['success', 'success', 'Passing', 'accent-success'],
        ['failure', 'failure', 'Failing', 'accent-failure'],
        ['in_progress', 'running', 'Running', 'accent-warning'],
        ['queued', 'queued', 'Queued', 'accent-info'],
        ['none', 'neutral', 'No runs', 'accent-neutral'],
      ];

    it.each(cases)(
      '%s → %s glyph, "%s" word, %s tone',
      (conclusion, glyphStatus, word, toneClass) => {
        const { container } = render(
          <CiTileBody repo={repo} data={data({ status: 'ready', conclusion })} size="standard" />,
        );
        expect(glyph(container, glyphStatus)).not.toBeNull();
        expect(screen.getByText(word, { selector: 'span' })).toBeInTheDocument();
        // The RunStrip cell carries the matching tone (redundant colour layer);
        // the body no longer paints an AmbientGlow (the frame owns PROBLEM glow).
        expect(
          container.querySelector(`[data-tone="${toneClass.replace('accent-', '')}"]`),
        ).not.toBeNull();
        // Word is tinted with the tone token (redundant colour layer).
        expect(screen.getByText(word, { selector: 'span' }).className).toContain(toneClass);
      },
    );
  });

  describe('failingCount', () => {
    it('states the failing count numerically when > 0 (standard)', () => {
      render(
        <CiTileBody
          repo={repo}
          data={data({ status: 'ready', conclusion: 'failure', failingCount: 2 })}
          size="standard"
        />,
      );
      expect(screen.getByText(/2 failing/i)).toBeInTheDocument();
    });

    it('does not show a failing count when zero / absent (all-clear)', () => {
      render(
        <CiTileBody
          repo={repo}
          data={data({ status: 'ready', conclusion: 'success' })}
          size="standard"
        />,
      );
      expect(screen.queryByText(/failing$/i)).toBeNull();
      // Never blank: positive all-clear copy is present.
      expect(screen.getByText(/no failing workflows/i)).toBeInTheDocument();
    });

    it('treats a numeric failingCount of 0 as all-clear (no count shown)', () => {
      render(
        <CiTileBody
          repo={repo}
          data={data({ status: 'ready', conclusion: 'success', failingCount: 0 })}
          size="standard"
        />,
      );
      expect(screen.queryByText(/failing$/i)).toBeNull();
      expect(screen.getByText(/no failing workflows/i)).toBeInTheDocument();
    });

    it('shows the failing count in the compact tier (failingCount or ✓)', () => {
      render(
        <CiTileBody
          repo={repo}
          data={data({ status: 'ready', conclusion: 'failure', failingCount: 3 })}
          size="compact"
        />,
      );
      expect(screen.getByText(/3 failing/i)).toBeInTheDocument();
    });
  });

  describe('size tiers', () => {
    const fullSlice: CiSignalSlice = {
      status: 'ready',
      conclusion: 'failure',
      failingCount: 1,
      latestRunUrl: 'https://github.com/octocat/hello-world/actions/runs/1',
    };

    it('compact: glyph present, status word hidden, no run link, no run-strip', () => {
      const { container } = render(
        <CiTileBody repo={repo} data={data(fullSlice)} size="compact" />,
      );
      expect(glyph(container, 'failure')).not.toBeNull();
      // The hero status word (BigValue span) is not rendered in the compact tier.
      expect(screen.queryByText('Failing', { selector: 'span' })).toBeNull();
      expect(screen.queryByRole('link')).toBeNull();
      // Compact = hero only; the micro-viz (RunStrip) is omitted.
      expect(container.querySelector('[data-shape]')).toBeNull();
    });

    it('compact all-clear suppresses the "No failing workflows" detail line', () => {
      // showDetail is gated to `size !== 'compact' || failing > 0`; an all-clear
      // (success, 0 failing) compact tile must therefore drop the detail line.
      render(
        <CiTileBody
          repo={repo}
          data={data({ status: 'ready', conclusion: 'success' })}
          size="compact"
        />,
      );
      expect(screen.queryByText(/no failing workflows/i)).toBeNull();
    });

    it('standard: glyph + status word + failing count + run-strip, but no run link', () => {
      const { container } = render(
        <CiTileBody repo={repo} data={data(fullSlice)} size="standard" />,
      );
      expect(glyph(container, 'failure')).not.toBeNull();
      expect(screen.getByText('Failing', { selector: 'span' })).toBeInTheDocument();
      expect(screen.getByText(/1 failing/i)).toBeInTheDocument();
      expect(container.querySelector('[data-shape="notch"]')).not.toBeNull();
      expect(screen.queryByRole('link')).toBeNull();
    });

    it('expanded: adds a "View latest run" link to the safe URL', () => {
      render(<CiTileBody repo={repo} data={data(fullSlice)} size="expanded" />);
      const link = screen.getByRole('link', { name: /view latest run/i });
      expect(link).toHaveAttribute('href', fullSlice.latestRunUrl);
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    });
  });

  describe('deep link safety (expanded)', () => {
    it('renders no link when latestRunUrl is absent', () => {
      render(
        <CiTileBody
          repo={repo}
          data={data({ status: 'ready', conclusion: 'failure', failingCount: 1 })}
          size="expanded"
        />,
      );
      expect(screen.queryByRole('link')).toBeNull();
    });

    it('renders no link when latestRunUrl is an unsafe / non-GitHub origin', () => {
      render(
        <CiTileBody
          repo={repo}
          data={data({
            status: 'ready',
            conclusion: 'failure',
            failingCount: 1,
            latestRunUrl: 'https://evil.example.com/octocat/hello-world/runs/1',
          })}
          size="expanded"
        />,
      );
      expect(screen.queryByRole('link')).toBeNull();
    });

    it('renders no link when latestRunUrl uses a javascript: scheme', () => {
      render(
        <CiTileBody
          repo={repo}
          data={data({
            status: 'ready',
            conclusion: 'failure',
            failingCount: 1,
            latestRunUrl: 'javascript:alert(1)',
          })}
          size="expanded"
        />,
      );
      expect(screen.queryByRole('link')).toBeNull();
    });
  });

  describe('states', () => {
    it('loading: routes through TileMessage (data-state="loading") + sr-only "Loading CI…"', () => {
      const { container } = render(
        <CiTileBody repo={repo} data={data({ status: 'loading' })} size="standard" />,
      );
      expect(container.querySelector('[data-state="loading"]')).not.toBeNull();
      expect(glyph(container, 'loading')).not.toBeNull();
      expect(screen.getByText(/loading ci/i)).toBeInTheDocument();
      // The visible status word itself (distinct from the sr-only "Loading CI…").
      expect(screen.getByText('Loading…', { selector: 'span' })).toBeInTheDocument();
    });

    it('error: routes through TileMessage (data-state="failed-to-load") + warning ⚠ glyph', () => {
      const { container } = render(
        <CiTileBody repo={repo} data={data({ status: 'error' })} size="standard" />,
      );
      expect(container.querySelector('[data-state="failed-to-load"]')).not.toBeNull();
      expect(glyph(container, 'warning')).not.toBeNull();
      expect(screen.getByText(/couldn't load ci/i, { selector: 'span' })).toBeInTheDocument();
    });

    it('loading and failed-to-load are distinguishable (different glyph AND data-state)', () => {
      const { container: loading } = render(
        <CiTileBody repo={repo} data={data({ status: 'loading' })} size="standard" />,
      );
      const { container: failed } = render(
        <CiTileBody repo={repo} data={data({ status: 'error' })} size="standard" />,
      );
      expect(loading.querySelector('[data-state="loading"]')).not.toBeNull();
      expect(failed.querySelector('[data-state="failed-to-load"]')).not.toBeNull();
      expect(glyph(loading, 'loading')).not.toBeNull();
      expect(glyph(failed, 'warning')).not.toBeNull();
    });

    it('unknown status: neutral glyph + "n/a"', () => {
      const { container } = render(
        <CiTileBody repo={repo} data={data({ status: 'unknown' })} size="standard" />,
      );
      expect(glyph(container, 'neutral')).not.toBeNull();
      expect(screen.getByText(/n\/a/i, { selector: 'span' })).toBeInTheDocument();
    });

    it('no CI slice at all: neutral glyph + "n/a" (never blank)', () => {
      const { container } = render(<CiTileBody repo={repo} data={{}} size="standard" />);
      expect(glyph(container, 'neutral')).not.toBeNull();
      expect(screen.getByText(/n\/a/i, { selector: 'span' })).toBeInTheDocument();
    });

    it("ready status with no conclusion falls back to 'No runs' (neutral)", () => {
      const { container } = render(
        <CiTileBody repo={repo} data={data({ status: 'ready' })} size="standard" />,
      );
      expect(glyph(container, 'neutral')).not.toBeNull();
      expect(screen.getByText('No runs', { selector: 'span' })).toBeInTheDocument();
    });

    it('out-of-enum conclusion falls back to a neutral, non-blank render (#185)', () => {
      // GitHub exposes conclusions beyond our 5-member enum (cancelled, skipped,
      // timed_out, action_required, neutral, stale). An unexpected value must
      // not throw a TypeError (→ blank tile, violating never-blank); it falls
      // back to the neutral "No runs" render.
      const slice = { status: 'ready', conclusion: 'cancelled' } as unknown as CiSignalSlice;
      let container: HTMLElement | undefined;
      expect(() => {
        container = render(<CiTileBody repo={repo} data={data(slice)} size="standard" />).container;
      }).not.toThrow();
      expect(glyph(container as HTMLElement, 'neutral')).not.toBeNull();
      expect(screen.getByText('No runs', { selector: 'span' })).toBeInTheDocument();
    });

    it('an Object.prototype member as the conclusion still falls back to neutral (#204)', () => {
      // A prototype-chain key ("toString", "constructor", …) is reachable via the
      // `in` operator even though it is NOT a real conclusion, so an `in`-based
      // guard would resolve it to `Object.prototype.toString` and destructure an
      // undefined glyph/word — a blank/garbage hero. The own-property guard must
      // reject it and fall back to the neutral "No runs" render.
      const slice = { status: 'ready', conclusion: 'toString' } as unknown as CiSignalSlice;
      let container: HTMLElement | undefined;
      expect(() => {
        container = render(<CiTileBody repo={repo} data={data(slice)} size="standard" />).container;
      }).not.toThrow();
      expect(glyph(container as HTMLElement, 'neutral')).not.toBeNull();
      expect(screen.getByText('No runs', { selector: 'span' })).toBeInTheDocument();
    });

    it('all-clear ready state is never blank', () => {
      const { container } = render(
        <CiTileBody
          repo={repo}
          data={data({ status: 'ready', conclusion: 'success' })}
          size="standard"
        />,
      );
      expect(glyph(container, 'success')).not.toBeNull();
      expect(screen.getByText('Passing', { selector: 'span' })).toBeInTheDocument();
    });

    it('exposes a data-state on the ready container ("ready" vs "unavailable")', () => {
      const { container: ready } = render(
        <CiTileBody
          repo={repo}
          data={data({ status: 'ready', conclusion: 'success' })}
          size="standard"
        />,
      );
      expect(ready.querySelector('[data-state="ready"]')).not.toBeNull();
      const { container: na } = render(
        <CiTileBody repo={repo} data={data({ status: 'unknown' })} size="standard" />,
      );
      expect(na.querySelector('[data-state="unavailable"]')).not.toBeNull();
      expect(na.querySelector('[data-state="ready"]')).toBeNull();
    });
  });

  describe('latest-run cell (RunStrip) + recency', () => {
    it('standard renders the RunStrip with the slice conclusion (success → solid)', () => {
      const { container } = render(
        <CiTileBody
          repo={repo}
          data={data({ status: 'ready', conclusion: 'success' })}
          size="standard"
        />,
      );
      expect(container.querySelector('[data-shape="solid"]')).not.toBeNull();
    });

    it('expanded renders the RunStrip with the slice conclusion (failure → notch)', () => {
      const { container } = render(
        <CiTileBody
          repo={repo}
          data={data({ status: 'ready', conclusion: 'failure', failingCount: 1 })}
          size="expanded"
        />,
      );
      expect(container.querySelector('[data-shape="notch"]')).not.toBeNull();
    });

    it('shows the latest-run recency (formatRelativeTime(updatedAt)) at standard tier', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(FIXED_NOW);
      const updatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      render(
        <CiTileBody
          repo={repo}
          data={data({ status: 'ready', conclusion: 'failure', failingCount: 2, updatedAt })}
          size="standard"
        />,
      );
      expect(screen.getByText(/5 minutes ago/i)).toBeInTheDocument();
    });

    it('omits recency when updatedAt is absent', () => {
      render(
        <CiTileBody
          repo={repo}
          data={data({ status: 'ready', conclusion: 'success' })}
          size="standard"
        />,
      );
      expect(screen.queryByText(/ago$/i)).toBeNull();
    });

    it('does not render an AmbientGlow tint (the frame owns the PROBLEM glow now)', () => {
      const { container } = render(
        <CiTileBody
          repo={repo}
          data={data({ status: 'ready', conclusion: 'failure', failingCount: 1 })}
          size="standard"
        />,
      );
      // The old body painted a full-bleed `absolute inset-0` glow; it is gone.
      expect(container.querySelector('.pointer-events-none.absolute.inset-0')).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('provides an sr-only summary describing the CI state', () => {
      const { container } = render(
        <CiTileBody
          repo={repo}
          data={data({ status: 'ready', conclusion: 'failure', failingCount: 2 })}
          size="standard"
        />,
      );
      const srOnly = container.querySelector('.sr-only');
      expect(srOnly).not.toBeNull();
      expect(srOnly?.textContent ?? '').toMatch(/failing/i);
    });

    it('gives the run link an accessible name at expanded tier', () => {
      render(
        <CiTileBody
          repo={repo}
          data={data({
            status: 'ready',
            conclusion: 'success',
            latestRunUrl: 'https://github.com/octocat/hello-world/actions/runs/9',
          })}
          size="expanded"
        />,
      );
      const link = screen.getByRole('link');
      expect(within(link).getByText(/view latest run/i)).toBeInTheDocument();
    });
  });

  it('accepts every TileTier without throwing', () => {
    const tiers: TileTier[] = ['compact', 'standard', 'expanded'];
    for (const size of tiers) {
      const { container } = render(
        <CiTileBody
          repo={repo}
          data={data({ status: 'ready', conclusion: 'queued' })}
          size={size}
        />,
      );
      expect(container.firstChild).not.toBeNull();
    }
  });
});

describe('CiTileBody — density-aware standard tier (T15)', () => {
  const fullSlice: CiSignalSlice = {
    status: 'ready',
    conclusion: 'failure',
    failingCount: 1,
    updatedAt: '2024-01-01T00:00:00Z',
    latestRunUrl: 'https://github.com/octocat/hello-world/actions/runs/1',
  };

  it('glanceable standard: keeps the hero but drops the RunStrip micro-viz', () => {
    const { container } = render(
      <CiTileBody repo={repo} data={data(fullSlice)} size="standard" density="glanceable" />,
    );
    expect(glyph(container, 'failure')).not.toBeNull();
    expect(screen.getByText('Failing', { selector: 'span' })).toBeInTheDocument();
    expect(container.querySelector('[data-shape]')).toBeNull();
  });

  it('balanced standard: keeps the RunStrip micro-viz (unchanged)', () => {
    const { container } = render(
      <CiTileBody repo={repo} data={data(fullSlice)} size="standard" density="balanced" />,
    );
    expect(container.querySelector('[data-shape]')).not.toBeNull();
  });

  it('glanceable expanded: keeps the RunStrip micro-viz (expanded unaffected)', () => {
    const { container } = render(
      <CiTileBody repo={repo} data={data(fullSlice)} size="expanded" density="glanceable" />,
    );
    expect(container.querySelector('[data-shape]')).not.toBeNull();
  });

  it('defaults to balanced when density is omitted (keeps the micro-viz)', () => {
    const { container } = render(<CiTileBody repo={repo} data={data(fullSlice)} size="standard" />);
    expect(container.querySelector('[data-shape]')).not.toBeNull();
  });

  it('glanceable standard: suppresses the latest-run recency meta (#294)', () => {
    // The recency meta shares the showStandardExtras gate; glanceable+standard
    // must hide the "Xm ago" timestamp (regression-coverage for the suppression
    // branch, which was previously unasserted).
    const updatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    render(
      <CiTileBody
        repo={repo}
        data={data({ status: 'ready', conclusion: 'failure', failingCount: 1, updatedAt })}
        size="standard"
        density="glanceable"
      />,
    );
    expect(screen.queryByText(/ago$/i)).toBeNull();
  });

  it('balanced standard: keeps the latest-run recency meta (contrast)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
    const updatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    render(
      <CiTileBody
        repo={repo}
        data={data({ status: 'ready', conclusion: 'failure', failingCount: 1, updatedAt })}
        size="standard"
        density="balanced"
      />,
    );
    expect(screen.getByText(/5 minutes ago/i)).toBeInTheDocument();
  });

  it('glanceable expanded: keeps the latest-run recency meta (expanded unaffected)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
    const updatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    render(
      <CiTileBody
        repo={repo}
        data={data({ status: 'ready', conclusion: 'failure', failingCount: 1, updatedAt })}
        size="expanded"
        density="glanceable"
      />,
    );
    expect(screen.getByText(/5 minutes ago/i)).toBeInTheDocument();
  });
});
