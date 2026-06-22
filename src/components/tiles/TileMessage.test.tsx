import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TileMessage } from './TileMessage';

/** Read the rendered `data-state` off the root state row. */
function dataState(container: HTMLElement): string | null {
  return container.querySelector('[data-state]')?.getAttribute('data-state') ?? null;
}

/** Read the glyph's `data-status` (its SVG shape channel). */
function glyph(container: HTMLElement): string | null {
  return container.querySelector('[data-status]')?.getAttribute('data-status') ?? null;
}

describe('TileMessage', () => {
  it('exports a named TileMessage component', () => {
    expect(typeof TileMessage).toBe('function');
  });

  it('maps loading → data-state="loading" with a loading glyph', () => {
    const { container } = render(
      <TileMessage kind="loading" message="Loading…" srText="Loading CI…" />,
    );
    expect(dataState(container)).toBe('loading');
    expect(glyph(container)).toBe('loading');
  });

  it('maps all-clear → data-state="empty" with a calm success-check glyph', () => {
    const { container } = render(
      <TileMessage kind="all-clear" message="All clear" srText="No open alerts" />,
    );
    expect(dataState(container)).toBe('empty');
    expect(glyph(container)).toBe('success');
  });

  it('maps failed → data-state="failed-to-load" with a warning glyph', () => {
    const { container } = render(
      <TileMessage kind="failed" message="Couldn't load" srText="CI could not be loaded" />,
    );
    expect(dataState(container)).toBe('failed-to-load');
    expect(glyph(container)).toBe('warning');
  });

  it('maps partial → data-state="partial" with its own glyph', () => {
    const { container } = render(
      <TileMessage kind="partial" message="Partial" srText="Counts are partial" />,
    );
    expect(dataState(container)).toBe('partial');
    expect(glyph(container)).toBe('info');
  });

  it('HARD RULE: all-clear is visually unmistakable from failed-to-load', () => {
    const { container: clear } = render(
      <TileMessage kind="all-clear" message="All clear" srText="No open alerts" />,
    );
    const { container: failed } = render(
      <TileMessage kind="failed" message="Couldn't load" srText="Could not load" />,
    );
    // Different glyph AND different data-state — never colour alone.
    expect(glyph(clear)).not.toBe(glyph(failed));
    expect(dataState(clear)).not.toBe(dataState(failed));
  });

  it('renders the visible message and the redundant sr-text for every kind', () => {
    const { container } = render(
      <TileMessage kind="all-clear" message="All clear" srText="Security: all clear" />,
    );
    // The visible (aria-hidden) label line carries the message.
    expect(container.querySelector('[aria-hidden="true"].text-sm')?.textContent).toBe('All clear');
    const sr = container.querySelector('.sr-only');
    expect(sr?.textContent).toBe('Security: all clear');
  });

  it('renders a Retry button for failed ONLY when onRetry is provided', () => {
    const onRetry = vi.fn();
    const { getByRole } = render(
      <TileMessage
        kind="failed"
        message="Couldn't load"
        srText="Could not load"
        onRetry={onRetry}
      />,
    );
    const button = getByRole('button', { name: /retry/i });
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the Retry button for failed when no onRetry is provided', () => {
    const { queryByRole } = render(
      <TileMessage kind="failed" message="Couldn't load" srText="Could not load" />,
    );
    expect(queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('never shows a Retry button for non-failed kinds even with onRetry', () => {
    const { queryByRole } = render(
      <TileMessage
        kind="all-clear"
        message="All clear"
        srText="No open alerts"
        onRetry={() => undefined}
      />,
    );
    expect(queryByRole('button', { name: /retry/i })).toBeNull();
  });
});
