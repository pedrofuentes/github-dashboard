import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TileBodyErrorBoundary } from './TileBodyErrorBoundary';

function ThrowingChild(): never {
  throw new Error('Render error from child component');
}

function SafeChild(): JSX.Element {
  return <div data-testid="safe-child">Safe content</div>;
}

describe('TileBodyErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('catches a render error and displays fallback UI; sibling boundary unaffected', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

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

    // The fallback should be present for the throwing boundary
    expect(container.querySelector('[data-state="failed-to-load"]')).not.toBeNull();
    expect(container.textContent).toMatch(/couldn.*t display/i);
    // The sibling boundary's child is unaffected — real sibling isolation assertion
    expect(getByTestId('safe-child')).toBeInTheDocument();
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
    vi.spyOn(console, 'error').mockImplementation(() => {});

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

    // First boundary catches error → fallback
    const fallback = container.querySelector('[data-state="failed-to-load"]');
    expect(fallback).not.toBeNull();
    // Second boundary is unaffected → renders child
    expect(getByTestId('safe-child')).toBeInTheDocument();
  });
});
