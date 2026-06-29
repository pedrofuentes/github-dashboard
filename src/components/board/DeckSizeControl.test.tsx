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

describe('DeckSizeControl — keyboard reverse/wrap + Home/End (#619)', () => {
  it('moves selection backward with ArrowLeft (medium → small)', async () => {
    const user = userEvent.setup();
    render(<DeckSizeControl />);

    const medium = screen.getByRole('radio', { name: /medium/i });
    medium.focus();
    await user.keyboard('{ArrowLeft}');

    expect(screen.getByRole('radio', { name: /^small/i })).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem(DECK_TILE_SIZE_KEY)).toBe('small');
  });

  it('moves selection backward with ArrowUp (medium → small)', async () => {
    const user = userEvent.setup();
    render(<DeckSizeControl />);

    const medium = screen.getByRole('radio', { name: /medium/i });
    medium.focus();
    await user.keyboard('{ArrowUp}');

    expect(screen.getByRole('radio', { name: /^small/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('wraps from the first option to the last with ArrowLeft', async () => {
    const user = userEvent.setup();
    render(<DeckSizeControl />);

    // Click x-small to make it the selected (focused) radio.
    await user.click(screen.getByRole('radio', { name: /x-small/i }));
    await user.keyboard('{ArrowLeft}');

    expect(screen.getByRole('radio', { name: /large/i })).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem(DECK_TILE_SIZE_KEY)).toBe('large');
  });

  it('wraps from the last option to the first with ArrowRight', async () => {
    const user = userEvent.setup();
    render(<DeckSizeControl />);

    // Click large to make it the selected (focused) radio.
    await user.click(screen.getByRole('radio', { name: /large/i }));
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('radio', { name: /x-small/i })).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem(DECK_TILE_SIZE_KEY)).toBe('x-small');
  });

  it('Home key jumps to the first option (X-Small) from any position', async () => {
    const user = userEvent.setup();
    render(<DeckSizeControl />);

    await user.click(screen.getByRole('radio', { name: /large/i }));
    await user.keyboard('{Home}');

    expect(screen.getByRole('radio', { name: /x-small/i })).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem(DECK_TILE_SIZE_KEY)).toBe('x-small');
  });

  it('End key jumps to the last option (Large) from any position', async () => {
    const user = userEvent.setup();
    render(<DeckSizeControl />);

    await user.click(screen.getByRole('radio', { name: /x-small/i }));
    await user.keyboard('{End}');

    expect(screen.getByRole('radio', { name: /large/i })).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem(DECK_TILE_SIZE_KEY)).toBe('large');
  });
});
