import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RunStrip } from './RunStrip';

/** Read the shape channel off the rendered cell. */
function shape(container: HTMLElement): string | null {
  return container.querySelector('[data-shape]')?.getAttribute('data-shape') ?? null;
}

describe('RunStrip', () => {
  it('exports a named RunStrip component', () => {
    expect(typeof RunStrip).toBe('function');
  });

  it('renders a failure run as a notched cell (non-colour channel)', () => {
    const { container } = render(<RunStrip conclusion="failure" srLabel="Latest run failing" />);
    expect(shape(container)).toBe('notch');
  });

  it('renders a success run as a solid filled cell', () => {
    const { container } = render(<RunStrip conclusion="success" srLabel="Latest run passing" />);
    expect(shape(container)).toBe('solid');
  });

  it('encodes queued and running with their literal shapes (distinct from pass/fail)', () => {
    const { container: queued } = render(
      <RunStrip conclusion="queued" srLabel="Latest run queued" />,
    );
    const { container: running } = render(
      <RunStrip conclusion="in_progress" srLabel="Latest run running" />,
    );

    // Literal shape tokens — not merely "distinct" — so a future SHAPE remap
    // that still happened to differ would not silently pass (#273).
    expect(shape(queued)).toBe('queued');
    expect(shape(running)).toBe('running');

    const shapes = new Set([shape(queued), shape(running), 'solid', 'notch']);
    // Four distinct conclusions → four distinct shape values.
    expect(shapes.size).toBe(4);
  });

  it('renders the "none" conclusion with its own shape', () => {
    const { container } = render(<RunStrip conclusion="none" srLabel="No runs" />);
    expect(shape(container)).toBe('none');
  });

  it('exposes the visual cell as decorative (aria-hidden)', () => {
    const { container } = render(<RunStrip conclusion="failure" srLabel="Latest run failing" />);
    const cell = container.querySelector('[data-shape]');
    expect(cell).not.toBeNull();
    expect(cell?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('renders the sr-only label as the textual channel', () => {
    const { container } = render(<RunStrip conclusion="failure" srLabel="Latest run failing" />);
    const srOnly = container.querySelector('.sr-only');
    expect(srOnly).not.toBeNull();
    expect(srOnly?.textContent).toBe('Latest run failing');
  });

  it('carries the conclusion tone as a redundant colour channel', () => {
    const { container } = render(<RunStrip conclusion="failure" srLabel="Latest run failing" />);
    expect(container.querySelector('[data-tone="failure"]')).not.toBeNull();
  });
});
