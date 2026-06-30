import { describe, expect, it, vi } from 'vitest';

import type { CommandItem } from '../components/CommandPalette';
import { buildCommandRegistry } from './commands';
import type { CommandRegistryHandlers } from './commands';

function makeHandlers(overrides: Partial<CommandRegistryHandlers> = {}): CommandRegistryHandlers {
  return {
    navigate: vi.fn(),
    openSettings: vi.fn(),
    filterNeedsAttention: vi.fn(),
    filterAwaitingReview: vi.fn(),
    filterFailingCi: vi.fn(),
    filterSecurityRisk: vi.fn(),
    filterStale: vi.fn(),
    clearFilters: vi.fn(),
    toggleTheme: vi.fn(),
    toggleDensity: vi.fn(),
    toggleRepoOwner: vi.fn(),
    ...overrides,
  };
}

function byId(commands: CommandItem[], id: string): CommandItem {
  const command = commands.find((c) => c.id === id);
  if (command === undefined) {
    throw new Error(`command ${id} not found`);
  }
  return command;
}

describe('buildCommandRegistry', () => {
  it('produces commands with stable ids, labels and groups', () => {
    const commands = buildCommandRegistry(makeHandlers());

    const ids = commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    const groups = new Set(commands.map((c) => c.group));
    expect(groups).toEqual(new Set(['Navigation', 'Filter', 'Settings', 'Appearance']));

    for (const command of commands) {
      expect(command.label.length).toBeGreaterThan(0);
      expect(Array.isArray(command.keywords)).toBe(true);
    }
  });

  it('navigation commands route to each fleet view', () => {
    const navigate = vi.fn();
    const commands = buildCommandRegistry(makeHandlers({ navigate }));

    byId(commands, 'nav-triage').run();
    byId(commands, 'nav-matrix').run();
    byId(commands, 'nav-grid').run();
    byId(commands, 'nav-inbox').run();
    byId(commands, 'nav-boards').run();
    byId(commands, 'nav-deck').run();

    expect(navigate.mock.calls.map((call) => call[0])).toEqual([
      'triage',
      'matrix',
      'grid',
      'inbox',
      'dashboard',
      'deck',
    ]);
  });

  it('"Go to Deck" command exists with correct id, label, and group', () => {
    const commands = buildCommandRegistry(makeHandlers());
    const cmd = byId(commands, 'nav-deck');

    expect(cmd.label).toBe('Go to Deck');
    expect(cmd.group).toBe('Navigation');
    expect(Array.isArray(cmd.keywords ?? [])).toBe(true);
    expect((cmd.keywords ?? []).length).toBeGreaterThan(0);
  });

  it('"Go to Deck" run() navigates to the deck view', () => {
    const navigate = vi.fn();
    const commands = buildCommandRegistry(makeHandlers({ navigate }));

    byId(commands, 'nav-deck').run();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('deck');
  });

  it('"Open Settings" invokes the settings handler', () => {
    const openSettings = vi.fn();
    const commands = buildCommandRegistry(makeHandlers({ openSettings }));

    byId(commands, 'open-settings').run();

    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('filter-preset commands invoke their respective handlers', () => {
    const handlers = makeHandlers();
    const commands = buildCommandRegistry(handlers);

    byId(commands, 'filter-needs-attention').run();
    byId(commands, 'filter-awaiting-review').run();
    byId(commands, 'filter-failing-ci').run();
    byId(commands, 'filter-security-risk').run();
    byId(commands, 'filter-stale').run();
    byId(commands, 'filter-clear').run();

    expect(handlers.filterNeedsAttention).toHaveBeenCalledTimes(1);
    expect(handlers.filterAwaitingReview).toHaveBeenCalledTimes(1);
    expect(handlers.filterFailingCi).toHaveBeenCalledTimes(1);
    expect(handlers.filterSecurityRisk).toHaveBeenCalledTimes(1);
    expect(handlers.filterStale).toHaveBeenCalledTimes(1);
    expect(handlers.clearFilters).toHaveBeenCalledTimes(1);
  });

  it('appearance commands toggle theme and density', () => {
    const handlers = makeHandlers();
    const commands = buildCommandRegistry(handlers);

    byId(commands, 'toggle-theme').run();
    byId(commands, 'toggle-density').run();

    expect(handlers.toggleTheme).toHaveBeenCalledTimes(1);
    expect(handlers.toggleDensity).toHaveBeenCalledTimes(1);
  });

  it('"Toggle repo owner" command exists with correct id, label, and group', () => {
    const commands = buildCommandRegistry(makeHandlers());
    const cmd = byId(commands, 'toggle-repo-owner');

    expect(cmd.label).toBe('Toggle repo owner');
    expect(cmd.group).toBe('Appearance');
    expect(Array.isArray(cmd.keywords ?? [])).toBe(true);
    expect((cmd.keywords ?? []).length).toBeGreaterThan(0);
  });

  it('"Toggle repo owner" run() invokes the toggleRepoOwner handler', () => {
    const toggleRepoOwner = vi.fn();
    const commands = buildCommandRegistry(makeHandlers({ toggleRepoOwner }));

    byId(commands, 'toggle-repo-owner').run();

    expect(toggleRepoOwner).toHaveBeenCalledTimes(1);
  });
});
