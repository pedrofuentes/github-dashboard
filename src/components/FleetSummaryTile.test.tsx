import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { FleetHealthSummary } from '../lib/fleet-summary';
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

  it('breaks the fleet down by health bucket with text labels (never colour alone)', () => {
    const region = (() => {
      render(
        <FleetSummaryTile
          summary={makeSummary({ total: 12, broken: 3, warning: 2, healthy: 7 })}
        />,
      );
      return screen.getByRole('region', { name: /fleet summary/i });
    })();
    expect(within(region).getByText(/3\s+need attention/i)).toBeInTheDocument();
    expect(within(region).getByText(/2\s+warning/i)).toBeInTheDocument();
    expect(within(region).getByText(/7\s+healthy/i)).toBeInTheDocument();
  });

  it('surfaces non-zero per-signal rollups', () => {
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
    expect(within(region).getByText(/2 failing CI/i)).toBeInTheDocument();
    expect(within(region).getByText(/1 security risk/i)).toBeInTheDocument();
    expect(within(region).getByText(/3 awaiting your review/i)).toBeInTheDocument();
    expect(within(region).getByText(/1 stale/i)).toBeInTheDocument();
  });

  it('decorative icons are hidden from assistive tech', () => {
    const { container } = render(
      <FleetSummaryTile summary={makeSummary({ total: 3, broken: 1, warning: 1, healthy: 1 })} />,
    );
    for (const icon of container.querySelectorAll('[aria-hidden="true"]')) {
      // Each decorative glyph must not expose a label of its own.
      expect(icon).not.toHaveAttribute('aria-label');
    }
    // The numeric counts remain readable as text content.
    const region = screen.getByRole('region', { name: /fleet summary/i });
    expect(region).toHaveTextContent('1 need attention');
  });
});
