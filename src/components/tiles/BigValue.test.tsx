import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BigValue } from './BigValue';

describe('BigValue', () => {
  it('renders the hero value', () => {
    render(<BigValue value={42} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders an optional muted sub-label', () => {
    render(<BigValue value="A+" sub="security grade" />);
    const sub = screen.getByText('security grade');
    expect(sub.className).toContain('text-text-muted');
  });

  it('omits the sub-label when not provided', () => {
    const { container } = render(<BigValue value={0} />);
    expect(container.querySelector('.text-text-muted')).toBeNull();
  });

  it('uses the neutral text token when no tone is given', () => {
    render(<BigValue value={7} />);
    expect(screen.getByText('7').className).toContain('text-text');
  });

  it('tints the value with the tone token when a tone is given', () => {
    render(<BigValue value={3} tone="failure" />);
    expect(screen.getByText('3').className).toContain('text-accent-failure');
  });

  it.each([
    ['compact', 'text-2xl'],
    ['standard', 'text-4xl'],
    ['expanded', 'text-6xl'],
  ] as const)('scales typography for the %s tier', (size, cls) => {
    render(<BigValue value={1} size={size} />);
    expect(screen.getByText('1').className).toContain(cls);
  });

  it('defaults to the standard tier sizing', () => {
    render(<BigValue value={9} />);
    expect(screen.getByText('9').className).toContain('text-4xl');
  });
});
