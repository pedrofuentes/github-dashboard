import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetDeckTileSizeStoreForTests } from '../../hooks/useDeckTileSize';
import { DeckSizeControl } from './DeckSizeControl';

const DECK_TILE_SIZE_KEY = 'fleet:deck-tile-size';

beforeEach(() => {
  localStorage.clear();
  __resetDeckTileSizeStoreForTests();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('DeckSizeControl', () => {
  it('exposes an accessible radiogroup with the four size choices', () => {
    render(<DeckSizeControl />);
    expect(screen.getByRole('radiogroup', { name: /tile size/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /x-small/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^small/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /medium/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /large/i })).toBeInTheDocument();
  });

  it('defaults to Medium when nothing is stored', () => {
    render(<DeckSizeControl />);
    expect(screen.getByRole('radio', { name: /medium/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('marks the stored choice as checked', () => {
    localStorage.setItem(DECK_TILE_SIZE_KEY, 'large');
    render(<DeckSizeControl />);
    expect(screen.getByRole('radio', { name: /large/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /medium/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('persists a new choice on click', async () => {
    const user = userEvent.setup();
    render(<DeckSizeControl />);

    await user.click(screen.getByRole('radio', { name: /x-small/i }));

    expect(screen.getByRole('radio', { name: /x-small/i })).toHaveAttribute('aria-checked', 'true');
    // Assert persistence via the stored value (not a setItem spy — see #124).
    expect(localStorage.getItem(DECK_TILE_SIZE_KEY)).toBe('x-small');
  });

  it('moves selection with the arrow keys (radiogroup roving)', async () => {
    const user = userEvent.setup();
    render(<DeckSizeControl />);

    const medium = screen.getByRole('radio', { name: /medium/i });
    medium.focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('radio', { name: /large/i })).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem(DECK_TILE_SIZE_KEY)).toBe('large');
  });

  it('keeps only the checked radio in the tab order (roving tabindex)', () => {
    render(<DeckSizeControl />);
    expect(screen.getByRole('radio', { name: /medium/i })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: /x-small/i })).toHaveAttribute('tabindex', '-1');
  });
});
