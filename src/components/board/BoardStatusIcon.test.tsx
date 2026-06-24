import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BoardStatusIcon } from './BoardStatusIcon';

const ALL_STATUSES = [
  'success',
  'failure',
  'in_progress',
  'cancelled',
  'queued',
  'pending',
  'waiting',
  'skipped',
  'timed_out',
  'action_required',
  'neutral',
  'stale',
  'requested',
  'deploying',
] as const;

describe('BoardStatusIcon — data-status attribute', () => {
  it.each(ALL_STATUSES)('sets data-status="%s" for known status', (status) => {
    const { container } = render(<BoardStatusIcon status={status} />);
    expect(container.querySelector('svg')).toHaveAttribute('data-status', status);
  });

  it('sets data-status for an unknown status (falls back to default icon)', () => {
    const { container } = render(<BoardStatusIcon status="unknown_xyz" />);
    expect(container.querySelector('svg')).toHaveAttribute('data-status', 'unknown_xyz');
  });
});

describe('BoardStatusIcon — accessibility', () => {
  it('is aria-hidden (decorative — label supplied by parent)', () => {
    const { container } = render(<BoardStatusIcon status="success" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it.each(ALL_STATUSES)('is aria-hidden for status "%s"', (status) => {
    const { container } = render(<BoardStatusIcon status={status} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('BoardStatusIcon — viewBox', () => {
  it.each(ALL_STATUSES)('has viewBox="0 0 36 36" for "%s"', (status) => {
    const { container } = render(<BoardStatusIcon status={status} />);
    expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 36 36');
  });
});

describe('BoardStatusIcon — size prop', () => {
  it('defaults size to 40', () => {
    const { container } = render(<BoardStatusIcon status="success" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '40');
    expect(svg).toHaveAttribute('height', '40');
  });

  it('accepts a custom size', () => {
    const { container } = render(<BoardStatusIcon status="success" size={24} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('height', '24');
  });
});

describe('BoardStatusIcon — no hex colors (currentColor only)', () => {
  it.each(ALL_STATUSES)('uses only currentColor, no hex colors, for "%s"', (status) => {
    const { container } = render(<BoardStatusIcon status={status} />);
    expect(container.querySelector('svg')?.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it('unknown status uses no hex colors', () => {
    const { container } = render(<BoardStatusIcon status="nope" />);
    expect(container.querySelector('svg')?.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});

describe('BoardStatusIcon — distinguishing SVG primitives', () => {
  it('success renders a polyline checkmark', () => {
    const { container } = render(<BoardStatusIcon status="success" />);
    expect(container.querySelector('polyline[points="8,19 15,26 28,12"]')).toBeInTheDocument();
  });

  it('failure renders two crossing lines forming an X', () => {
    const { container } = render(<BoardStatusIcon status="failure" />);
    expect(container.querySelector('line[x1="10"][y1="10"]')).toBeInTheDocument();
    expect(container.querySelector('line[x1="26"][y1="10"]')).toBeInTheDocument();
  });

  it('in_progress renders a polygon arrowhead on the circular arrow', () => {
    const { container } = render(<BoardStatusIcon status="in_progress" />);
    expect(container.querySelector('polygon[points="6,12 6,20 11,16"]')).toBeInTheDocument();
  });

  it('cancelled renders a circle with a diagonal slash', () => {
    const { container } = render(<BoardStatusIcon status="cancelled" />);
    expect(container.querySelector('line[x1="10"][y1="26"]')).toBeInTheDocument();
  });

  it('queued renders a clock face with hour and minute hands', () => {
    const { container } = render(<BoardStatusIcon status="queued" />);
    expect(container.querySelector('line[x1="18"][y1="11"]')).toBeInTheDocument();
    expect(container.querySelector('line[x1="18"][y1="18"][x2="24"]')).toBeInTheDocument();
  });

  it('pending renders three filled dots', () => {
    const { container } = render(<BoardStatusIcon status="pending" />);
    expect(container.querySelector('circle[cx="8"][cy="18"][r="3"]')).toBeInTheDocument();
    expect(container.querySelector('circle[cx="18"][cy="18"][r="3"]')).toBeInTheDocument();
    expect(container.querySelector('circle[cx="28"][cy="18"][r="3"]')).toBeInTheDocument();
  });

  it('waiting renders the same clock face as queued', () => {
    const { container } = render(<BoardStatusIcon status="waiting" />);
    expect(container.querySelector('line[x1="18"][y1="11"]')).toBeInTheDocument();
    expect(container.querySelector('line[x1="18"][y1="18"][x2="24"]')).toBeInTheDocument();
  });

  it('skipped renders a forward-arrow polyline', () => {
    const { container } = render(<BoardStatusIcon status="skipped" />);
    expect(container.querySelector('polyline[points="20,10 28,18 20,26"]')).toBeInTheDocument();
  });

  it('timed_out renders a circle with an X inside', () => {
    const { container } = render(<BoardStatusIcon status="timed_out" />);
    expect(container.querySelector('line[x1="14"][y1="14"]')).toBeInTheDocument();
    expect(container.querySelector('line[x1="22"][y1="14"]')).toBeInTheDocument();
  });

  it('action_required renders a triangle warning sign', () => {
    const { container } = render(<BoardStatusIcon status="action_required" />);
    expect(container.querySelector('polygon[points="18,6 32,30 4,30"]')).toBeInTheDocument();
  });

  it('neutral renders a horizontal dash line', () => {
    const { container } = render(<BoardStatusIcon status="neutral" />);
    expect(container.querySelector('line[x1="8"][y1="18"][x2="28"][y2="18"]')).toBeInTheDocument();
  });

  it('stale renders a horizontal dash line (same shape as neutral)', () => {
    const { container } = render(<BoardStatusIcon status="stale" />);
    expect(container.querySelector('line[x1="8"][y1="18"][x2="28"][y2="18"]')).toBeInTheDocument();
  });

  it('requested renders a bullseye (outer circle + inner filled circle)', () => {
    const { container } = render(<BoardStatusIcon status="requested" />);
    expect(container.querySelectorAll('circle')).toHaveLength(2);
    expect(container.querySelector('circle[r="4"]')).toBeInTheDocument();
  });

  it('deploying renders a rocket/upward-arrow polygon', () => {
    const { container } = render(<BoardStatusIcon status="deploying" />);
    expect(container.querySelector('polygon[points="18,6 28,28 18,22 8,28"]')).toBeInTheDocument();
  });

  it('unknown status renders a question mark text element', () => {
    const { container } = render(<BoardStatusIcon status="anything_unknown" />);
    expect(container.querySelector('text')).toBeInTheDocument();
  });

  it('unknown status question mark contains "?"', () => {
    const { container } = render(<BoardStatusIcon status="mystery" />);
    expect(container.querySelector('text')?.textContent).toBe('?');
  });
});
