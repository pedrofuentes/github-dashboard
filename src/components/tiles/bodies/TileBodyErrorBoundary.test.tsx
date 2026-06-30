import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TileBodyErrorBoundary } from './TileBodyErrorBoundary';

function ThrowingChild(): never {
  throw new Error('Render error from child component');
}

function SafeChild(): JSX.Element {
  return <div data-testid="safe-child">Safe content</div>;
}

describe('TileBodyErrorBoundary', () => {
  it('catches a render error and displays fallback UI', () => {
    // Suppress console.error noise from React error boundaries in tests
    const originalError = console.error;
    console.error = () => {};

    const { container, queryByTestId } = render(
      <TileBodyErrorBoundary>
        <ThrowingChild />
      </TileBodyErrorBoundary>,
    );

    console.error = originalError;

    // The throwing child should not render
    expect(queryByTestId('safe-child')).toBeNull();
    // The fallback should be present
    expect(container.querySelector('[data-state="failed-to-load"]')).not.toBeNull();
    expect(container.textContent).toMatch(/couldn.*t display/i);
  });

  it('renders children normally when no error occurs', () => {
    const { getByTestId } = render(
      <TileBodyErrorBoundary>
        <SafeChild />
      </TileBodyErrorBoundary>,
    );

    expect(getByTestId('safe-child')).toBeInTheDocument();
  });

  it('isolates errors: sibling tiles remain unaffected', () => {
    const originalError = console.error;
    console.error = () => {};

    const { container, getByTestId } = render(
      <div>
        <TileBodyErrorBoundary>
          <ThrowingChild />
        </TileBodyErrorBoundary>
        <TileBodyErrorBoundary>
          <SafeChild />
        </TileBodyErrorBoundary>
      </div>,
    );

    console.error = originalError;

    // First boundary catches error → fallback
    const fallback = container.querySelector('[data-state="failed-to-load"]');
    expect(fallback).not.toBeNull();
    // Second boundary is unaffected → renders child
    expect(getByTestId('safe-child')).toBeInTheDocument();
  });
});
