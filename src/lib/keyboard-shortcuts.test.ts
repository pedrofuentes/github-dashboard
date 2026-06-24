import { describe, expect, it } from 'vitest';

import { matchShortcut, NAVIGATION_TARGETS, SHORTCUTS } from './keyboard-shortcuts';

describe('matchShortcut', () => {
  it('starts the "g" prefix sequence without firing an action', () => {
    expect(matchShortcut(null, 'g')).toEqual({ pending: 'g' });
  });

  it('completes "g t" to the triage navigation action and resets the prefix', () => {
    expect(matchShortcut('g', 't')).toEqual({ action: 'navigate-triage', pending: null });
  });

  it.each([
    ['t', 'navigate-triage'],
    ['m', 'navigate-matrix'],
    ['g', 'navigate-grid'],
    ['b', 'navigate-dashboard'],
    ['i', 'navigate-inbox'],
    ['d', 'navigate-deck'],
  ])('maps the "g %s" sequence to %s', (key, action) => {
    expect(matchShortcut('g', key)).toEqual({ action, pending: null });
  });

  it('resets without an action when the second key is unmapped', () => {
    expect(matchShortcut('g', 'z')).toEqual({ pending: null });
  });

  it('opens the help overlay on "?" from the idle state', () => {
    expect(matchShortcut(null, '?')).toEqual({ action: 'open-help', pending: null });
  });

  it('opens settings on "," from the idle state', () => {
    expect(matchShortcut(null, ',')).toEqual({ action: 'open-settings', pending: null });
  });

  it('ignores unmapped keys from the idle state', () => {
    expect(matchShortcut(null, 'q')).toEqual({ pending: null });
  });

  it('normalises an upper-case prefix key (Caps Lock / Shift) to lower case', () => {
    expect(matchShortcut(null, 'G')).toEqual({ pending: 'g' });
    expect(matchShortcut('g', 'I')).toEqual({ action: 'navigate-inbox', pending: null });
  });
});

describe('SHORTCUTS definition list', () => {
  it('documents every navigation sequence with its display keys', () => {
    const byId = new Map(SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));
    expect(byId.get('navigate-triage')).toMatchObject({ keys: 'g t', group: 'Navigation' });
    expect(byId.get('navigate-matrix')).toMatchObject({ keys: 'g m', group: 'Navigation' });
    expect(byId.get('navigate-grid')).toMatchObject({ keys: 'g g', group: 'Navigation' });
    expect(byId.get('navigate-dashboard')).toMatchObject({ keys: 'g b', group: 'Navigation' });
    expect(byId.get('navigate-inbox')).toMatchObject({ keys: 'g i', group: 'Navigation' });
    expect(byId.get('navigate-deck')).toMatchObject({ keys: 'g d', group: 'Navigation' });
  });

  it('documents the help shortcut in the General group', () => {
    const help = SHORTCUTS.find((shortcut) => shortcut.id === 'open-help');
    expect(help).toMatchObject({ keys: '?', group: 'General' });
    expect(help?.description).toMatch(/keyboard shortcuts/i);
  });

  it('documents the deck navigation shortcut with its "Go to Deck" description', () => {
    const deck = SHORTCUTS.find((shortcut) => shortcut.id === 'navigate-deck');
    expect(deck).toMatchObject({ keys: 'g d', group: 'Navigation' });
    expect(deck?.description).toBe('Go to Deck');
  });

  it('documents the ⌘K command palette without it being a bound action', () => {
    const palette = SHORTCUTS.find((shortcut) => shortcut.id === 'command-palette');
    expect(palette).toMatchObject({ group: 'General' });
    expect(palette?.keys).toMatch(/K/);
    expect(palette?.description).toMatch(/command palette/i);
    // The palette is documented only — the matcher never returns it as an action.
    expect(matchShortcut(null, 'k')).toEqual({ pending: null });
  });
});

describe('NAVIGATION_TARGETS', () => {
  it('maps each navigation action id to its fleet view', () => {
    expect(NAVIGATION_TARGETS['navigate-triage']).toBe('triage');
    expect(NAVIGATION_TARGETS['navigate-matrix']).toBe('matrix');
    expect(NAVIGATION_TARGETS['navigate-grid']).toBe('grid');
    expect(NAVIGATION_TARGETS['navigate-dashboard']).toBe('dashboard');
    expect(NAVIGATION_TARGETS['navigate-inbox']).toBe('inbox');
    expect(NAVIGATION_TARGETS['navigate-deck']).toBe('deck');
  });
});
