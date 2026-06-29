import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CenteredState } from './CenteredState';

describe('CenteredState', () => {
  it('exposes the supplied state via data-state', () => {
    const { container } = render(
      <CenteredState
        state="unavailable"
        tone="muted"
        glyph={<svg data-testid="g" />}
        message="n/a"
        srText="Not loaded"
      />,
    );
    expect(container.querySelector('[data-state="unavailable"]')).not.toBeNull();
  });

  it('paints the muted tone with the text-muted token (never colour alone)', () => {
    const { container } = render(
      <CenteredState
        state="unavailable"
        tone="muted"
        glyph={<svg />}
        message="n/a"
        srText="Not loaded"
      />,
    );
    const root = container.querySelector('[data-state="unavailable"]') as HTMLElement;
    expect(root.className).toContain('text-text-muted');
    expect(root.className).not.toContain('text-accent-failure');
  });

  it('paints the error tone with the failure accent token', () => {
    const { container } = render(
      <CenteredState
        state="error"
        tone="error"
        glyph={<svg />}
        message="Couldn't load"
        srText="Failed"
      />,
    );
    const root = container.querySelector('[data-state="error"]') as HTMLElement;
    expect(root.className).toContain('text-accent-failure');
  });

  it('renders the visible message as decorative (aria-hidden)', () => {
    const { getByText } = render(
      <CenteredState
        state="unavailable"
        tone="muted"
        glyph={<svg />}
        message="n/a"
        srText="Not loaded"
      />,
    );
    expect(getByText('n/a')).toHaveAttribute('aria-hidden', 'true');
  });

  it('carries the screen-reader sentence in an sr-only span', () => {
    const { container } = render(
      <CenteredState
        state="unavailable"
        tone="muted"
        glyph={<svg />}
        message="n/a"
        srText="Review queue not loaded"
      />,
    );
    const srOnly = container.querySelector('.sr-only');
    expect(srOnly?.textContent).toBe('Review queue not loaded');
  });

  it('renders the supplied glyph', () => {
    const { getByTestId } = render(
      <CenteredState
        state="unavailable"
        tone="muted"
        glyph={<svg data-testid="status-glyph" />}
        message="n/a"
        srText="Not loaded"
      />,
    );
    expect(getByTestId('status-glyph')).toBeInTheDocument();
  });
});
