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

  it('renders a three-way health-split bar segment for each non-zero bucket', () => {
    const { container } = render(
      <FleetSummaryTile
        summary={makeSummary({ total: 12, broken: 3, warning: 2, healthy: 7 })}
      />,
    );
    // The coloured bar carries one proportional segment per non-zero bucket,
    // tinted with the health tone (failure / warning / success).
    expect(container.querySelector('[data-tone="failure"]')).toBeInTheDocument();
    expect(container.querySelector('[data-tone="warning"]')).toBeInTheDocument();
    expect(container.querySelector('[data-tone="success"]')).toBeInTheDocument();
  });

  it('exposes the health split to assistive tech via labelled regions', () => {
    render(
      <FleetSummaryTile
        summary={makeSummary({ total: 12, broken: 3, warning: 2, healthy: 7 })}
      />,
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
      <FleetSummaryTile
        summary={makeSummary({ total: 12, broken: 3, warning: 2, healthy: 7 })}
      />,
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
});
