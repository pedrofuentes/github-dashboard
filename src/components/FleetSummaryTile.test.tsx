import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { FleetHealthSummary, RepoHealthEntry } from '../lib/fleet-summary';
import { FleetSummaryTile } from './FleetSummaryTile';

function makeSummary(overrides: Partial<FleetHealthSummary> = {}): FleetHealthSummary {
  return {
    total: 0,
    broken: 0,
    warning: 0,
    healthy: 0,
    failingCi: 0,
    securityRisk: 0,
    issuesOverThreshold: 0,
    staleRepos: 0,
    reviewRequested: 0,
    ...overrides,
  };
}

describe('FleetSummaryTile', () => {
  it('renders an accessible fleet-summary region', () => {
    render(<FleetSummaryTile summary={makeSummary({ total: 5, healthy: 5 })} />);
    expect(screen.getByRole('region', { name: /fleet summary/i })).toBeInTheDocument();
  });

  it('shows the total repo count', () => {
    render(<FleetSummaryTile summary={makeSummary({ total: 12, healthy: 12 })} />);
    expect(screen.getByRole('region', { name: /fleet summary/i })).toHaveTextContent('12 repos');
  });

  it('uses the singular noun for a single repo', () => {
    render(<FleetSummaryTile summary={makeSummary({ total: 1, healthy: 1 })} />);
    expect(screen.getByRole('region', { name: /fleet summary/i })).toHaveTextContent('1 repo');
  });

  it('renders a three-way health-split bar segment for each non-zero bucket', () => {
    const { container } = render(
      <FleetSummaryTile summary={makeSummary({ total: 12, broken: 3, warning: 2, healthy: 7 })} />,
    );
    // The coloured bar carries one proportional segment per non-zero bucket,
    // tinted with the health tone (failure / warning / success).
    expect(container.querySelector('[data-tone="failure"]')).toBeInTheDocument();
    expect(container.querySelector('[data-tone="warning"]')).toBeInTheDocument();
    expect(container.querySelector('[data-tone="success"]')).toBeInTheDocument();
  });

  it('exposes the health split to assistive tech via labelled regions', () => {
    render(
      <FleetSummaryTile summary={makeSummary({ total: 12, broken: 3, warning: 2, healthy: 7 })} />,
    );
    const region = screen.getByRole('region', { name: /fleet summary/i });
    // SeverityBar emits an sr-only "Label: value" breakdown so meaning never
    // rests on colour alone.
    expect(within(region).getByText(/need attention:\s*3/i)).toBeInTheDocument();
    expect(within(region).getByText(/warning:\s*2/i)).toBeInTheDocument();
    expect(within(region).getByText(/healthy:\s*7/i)).toBeInTheDocument();
  });

  it('breaks the fleet down by health bucket with icon + count + word labels', () => {
    render(
      <FleetSummaryTile summary={makeSummary({ total: 12, broken: 3, warning: 2, healthy: 7 })} />,
    );
    const region = screen.getByRole('region', { name: /fleet summary/i });
    expect(within(region).getByText(/3\s+need attention/i)).toBeInTheDocument();
    expect(within(region).getByText(/2\s+warning/i)).toBeInTheDocument();
    expect(within(region).getByText(/7\s+healthy/i)).toBeInTheDocument();
  });

  it('only paints bar segments for non-zero buckets', () => {
    const { container } = render(
      <FleetSummaryTile summary={makeSummary({ total: 4, broken: 4 })} />,
    );
    expect(container.querySelector('[data-tone="failure"]')).toBeInTheDocument();
    expect(container.querySelector('[data-tone="warning"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-tone="success"]')).not.toBeInTheDocument();
  });

  it('surfaces each non-zero per-signal rollup as a tinted chip', () => {
    render(
      <FleetSummaryTile
        summary={makeSummary({
          total: 4,
          broken: 2,
          warning: 1,
          healthy: 1,
          failingCi: 2,
          securityRisk: 1,
          issuesOverThreshold: 1,
          staleRepos: 1,
          reviewRequested: 3,
        })}
      />,
    );
    const region = screen.getByRole('region', { name: /fleet summary/i });

    const ci = within(region).getByText(/2 failing CI/i);
    expect(ci.closest('[data-tone="failure"]')).not.toBeNull();

    const security = within(region).getByText(/1 security risk/i);
    expect(security.closest('[data-tone="failure"]')).not.toBeNull();

    const issues = within(region).getByText(/1 over issue threshold/i);
    expect(issues.closest('[data-tone="warning"]')).not.toBeNull();

    const reviews = within(region).getByText(/3 awaiting your review/i);
    expect(reviews.closest('[data-tone="warning"]')).not.toBeNull();

    const stale = within(region).getByText(/1 stale/i);
    expect(stale.closest('[data-tone="warning"]')).not.toBeNull();
  });

  it('omits per-signal rollup chips whose count is zero', () => {
    render(
      <FleetSummaryTile
        summary={makeSummary({ total: 3, broken: 1, warning: 0, healthy: 2, failingCi: 1 })}
      />,
    );
    const region = screen.getByRole('region', { name: /fleet summary/i });
    expect(within(region).getByText(/1 failing CI/i)).toBeInTheDocument();
    expect(within(region).queryByText(/security risk/i)).not.toBeInTheDocument();
    expect(within(region).queryByText(/over issue threshold/i)).not.toBeInTheDocument();
    expect(within(region).queryByText(/awaiting your review/i)).not.toBeInTheDocument();
    expect(within(region).queryByText(/stale/i)).not.toBeInTheDocument();
  });

  it('renders an empty fleet as "0 repos" with no health split or rollups', () => {
    const { container } = render(<FleetSummaryTile summary={makeSummary({ total: 0 })} />);
    const region = screen.getByRole('region', { name: /fleet summary/i });
    expect(region).toHaveTextContent('0 repos');
    expect(within(region).queryByText(/need attention/i)).not.toBeInTheDocument();
    expect(within(region).queryByText(/failing CI/i)).not.toBeInTheDocument();
    expect(container.querySelector('[data-tone]')).toBeNull();
  });

  it('keeps decorative glyphs hidden from assistive tech', () => {
    const { container } = render(
      <FleetSummaryTile summary={makeSummary({ total: 3, broken: 1, warning: 1, healthy: 1 })} />,
    );
    for (const hidden of container.querySelectorAll('[aria-hidden="true"]')) {
      // A decorative wrapper must not expose an accessible label of its own.
      expect(hidden).not.toHaveAttribute('aria-label');
    }
    // The numeric counts remain readable as plain text.
    const region = screen.getByRole('region', { name: /fleet summary/i });
    expect(region).toHaveTextContent('1 need attention');
  });

  describe('inflaming edge (R4)', () => {
    it('inflames to a 6px failure edge when a child is broken', () => {
      const { container } = render(
        <FleetSummaryTile
          summary={makeSummary({ total: 2, broken: 1, healthy: 1 })}
          entries={[
            { repo: 'octo/a', health: 'broken' },
            { repo: 'octo/b', health: 'healthy' },
          ]}
        />,
      );
      const edge = container.querySelector('[data-part="fleet-edge"]');
      expect(edge).not.toBeNull();
      const bar = edge?.querySelector('[data-tone]');
      expect(bar).toHaveAttribute('data-tone', 'failure');
      expect(bar?.className).toContain('h-[6px]');
    });

    it('stays a neutral 5px rail when no child is broken', () => {
      const { container } = render(
        <FleetSummaryTile
          summary={makeSummary({ total: 2, warning: 1, healthy: 1 })}
          entries={[
            { repo: 'octo/a', health: 'warning' },
            { repo: 'octo/b', health: 'healthy' },
          ]}
        />,
      );
      const edge = container.querySelector('[data-part="fleet-edge"]');
      const bar = edge?.querySelector('[data-tone]');
      expect(bar).toHaveAttribute('data-tone', 'neutral');
      expect(bar?.className).toContain('h-[5px]');
    });
  });

  describe('per-repo worst-state strip', () => {
    const entries: RepoHealthEntry[] = [
      { repo: 'octo/healthy', health: 'healthy' },
      { repo: 'octo/broken', health: 'broken' },
      { repo: 'octo/warning', health: 'warning' },
    ];

    it('renders one strip cell per entry', () => {
      const { container } = render(
        <FleetSummaryTile
          summary={makeSummary({ total: 3, broken: 1, warning: 1, healthy: 1 })}
          entries={entries}
        />,
      );
      const strip = container.querySelector('[data-part="repo-strip"]');
      expect(strip).not.toBeNull();
      expect(strip?.querySelectorAll('[data-health]')).toHaveLength(3);
    });

    it('orders cells worst-first and steps their height by state', () => {
      const { container } = render(
        <FleetSummaryTile
          summary={makeSummary({ total: 3, broken: 1, warning: 1, healthy: 1 })}
          entries={entries}
        />,
      );
      const strip = container.querySelector('[data-part="repo-strip"]');
      const cells = Array.from(strip?.querySelectorAll('[data-health]') ?? []);
      // Worst-first: broken, then warning, then healthy.
      expect(cells.map((cell) => cell.getAttribute('data-health'))).toEqual([
        'broken',
        'warning',
        'healthy',
      ]);
      // Broken is the tallest cell, healthy the shortest (grayscale-survivable).
      const heightOf = (health: string): string =>
        cells.find((cell) => cell.getAttribute('data-health') === health)?.className ?? '';
      expect(heightOf('broken')).toContain('h-4');
      expect(heightOf('warning')).toContain('h-2.5');
      expect(heightOf('healthy')).toContain('h-1.5');
    });

    it('exposes the per-repo state as an sr-only list so it survives grayscale', () => {
      render(
        <FleetSummaryTile
          summary={makeSummary({ total: 3, broken: 1, warning: 1, healthy: 1 })}
          entries={entries}
        />,
      );
      const region = screen.getByRole('region', { name: /fleet summary/i });
      expect(within(region).getByText(/octo\/broken:\s*broken/i)).toBeInTheDocument();
      expect(within(region).getByText(/octo\/warning:\s*warning/i)).toBeInTheDocument();
      expect(within(region).getByText(/octo\/healthy:\s*healthy/i)).toBeInTheDocument();
    });

    it('renders no strip for an empty fleet', () => {
      const { container } = render(
        <FleetSummaryTile summary={makeSummary({ total: 0 })} entries={[]} />,
      );
      expect(container.querySelector('[data-part="repo-strip"]')).toBeNull();
    });
  });

  describe('worst-child chip', () => {
    it('names the first broken repo in a top-right chip', () => {
      const { container } = render(
        <FleetSummaryTile
          summary={makeSummary({ total: 3, broken: 1, warning: 1, healthy: 1 })}
          entries={[
            { repo: 'octo/healthy', health: 'healthy' },
            { repo: 'octo/breaks', health: 'broken' },
            { repo: 'octo/warns', health: 'warning' },
          ]}
        />,
      );
      const chip = container.querySelector('[data-part="worst-child"]');
      expect(chip).not.toBeNull();
      expect(chip).toHaveTextContent('octo/breaks');
    });

    it('falls back to the first warning repo when none are broken', () => {
      const { container } = render(
        <FleetSummaryTile
          summary={makeSummary({ total: 2, warning: 1, healthy: 1 })}
          entries={[
            { repo: 'octo/healthy', health: 'healthy' },
            { repo: 'octo/warns', health: 'warning' },
          ]}
        />,
      );
      const chip = container.querySelector('[data-part="worst-child"]');
      expect(chip).toHaveTextContent('octo/warns');
    });

    it('shows no worst-child chip when every repo is healthy', () => {
      const { container } = render(
        <FleetSummaryTile
          summary={makeSummary({ total: 2, healthy: 2 })}
          entries={[
            { repo: 'octo/a', health: 'healthy' },
            { repo: 'octo/b', health: 'healthy' },
          ]}
        />,
      );
      expect(container.querySelector('[data-part="worst-child"]')).toBeNull();
    });
  });

  describe('ranked footer', () => {
    it('emphasises act-now rollups and mutes informational ones', () => {
      render(
        <FleetSummaryTile
          summary={makeSummary({
            total: 4,
            broken: 2,
            warning: 2,
            failingCi: 2,
            securityRisk: 1,
            issuesOverThreshold: 1,
            reviewRequested: 3,
            staleRepos: 1,
          })}
          entries={[]}
        />,
      );
      const region = screen.getByRole('region', { name: /fleet summary/i });
      // Act-now (failure-tone) metrics are emphasised…
      expect(
        within(region)
          .getByText(/2 failing CI/i)
          .closest('[data-rank]'),
      ).toHaveAttribute('data-rank', 'act-now');
      expect(
        within(region)
          .getByText(/1 security risk/i)
          .closest('[data-rank]'),
      ).toHaveAttribute('data-rank', 'act-now');
      // …while informational metrics are muted.
      expect(
        within(region)
          .getByText(/3 awaiting your review/i)
          .closest('[data-rank]'),
      ).toHaveAttribute('data-rank', 'info');
      expect(
        within(region)
          .getByText(/1 stale/i)
          .closest('[data-rank]'),
      ).toHaveAttribute('data-rank', 'info');
    });
  });
});
