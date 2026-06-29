import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_VIEW_NAME_LENGTH,
  MAX_SAVED_VIEWS,
  STORAGE_KEY_V1,
  type SavedView,
  type SavedViewsState,
} from '../lib/saved-views';
import { EMPTY_QUERY, type RepoFilterQueryV2 } from '../lib/repo-filter-query';
import { useSavedViews, validateViewName, type SavedViewMutationResult } from './useSavedViews';

/** Asserts a successful mutation and returns its non-optional view. */
function expectView(result: SavedViewMutationResult): SavedView {
  expect(result.ok).toBe(true);
  if (result.view === undefined) {
    throw new Error('expected a created view');
  }
  return result.view;
}

/** Reads the persisted state straight from storage (round-trip, not a spy). */
function persisted(): SavedViewsState | null {
  const raw = localStorage.getItem(STORAGE_KEY_V1);
  return raw === null ? null : (JSON.parse(raw) as SavedViewsState);
}

const ALT_QUERY: RepoFilterQueryV2 = {
  version: 2,
  text: 'octo',
  repoSelection: { mode: 'all', names: [] },
  facets: {
    owners: ['octo'],
    health: [],
    ci: [],
    security: { grades: [], severities: [] },
    pullRequests: [],
    reviews: [],
    issues: [],
    stale: [],
    visibility: [],
  },
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('validateViewName', () => {
  it('rejects an empty / whitespace-only name', () => {
    expect(validateViewName('')).not.toBeNull();
    expect(validateViewName('   ')).not.toBeNull();
  });

  it('rejects a name over the lib bound', () => {
    expect(validateViewName('a'.repeat(MAX_VIEW_NAME_LENGTH + 1))).not.toBeNull();
  });

  it('accepts a valid name', () => {
    expect(validateViewName('My view')).toBeNull();
  });
});

describe('useSavedViews', () => {
  it('starts empty when storage is empty', () => {
    const { result } = renderHook(() => useSavedViews());
    expect(result.current.views).toEqual([]);
  });

  it('creates and persists a view (round-trip)', () => {
    const { result } = renderHook(() => useSavedViews());

    let outcome!: ReturnType<typeof result.current.create>;
    act(() => {
      outcome = result.current.create({ name: 'Broken CI', view: 'triage', filter: EMPTY_QUERY });
    });

    expect(outcome.ok).toBe(true);
    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0].name).toBe('Broken CI');

    const stored = persisted();
    expect(stored?.views).toHaveLength(1);
    expect(stored?.views[0].name).toBe('Broken CI');
    expect(stored?.views[0].view).toBe('triage');
  });

  it('reports create failure when persistence is unavailable', () => {
    const { result } = renderHook(() => useSavedViews());
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    let outcome!: ReturnType<typeof result.current.create>;
    act(() => {
      outcome = result.current.create({ name: 'Broken CI', view: 'triage', filter: EMPTY_QUERY });
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();
    expect(result.current.views).toEqual([]);
    expect(persisted()).toBeNull();
  });

  it('trims the name before persisting', () => {
    const { result } = renderHook(() => useSavedViews());
    act(() => {
      result.current.create({ name: '  Spaced  ', view: 'matrix', filter: EMPTY_QUERY });
    });
    expect(persisted()?.views[0].name).toBe('Spaced');
  });

  it('rejects an empty name without persisting and returns an error', () => {
    const { result } = renderHook(() => useSavedViews());

    let outcome!: ReturnType<typeof result.current.create>;
    act(() => {
      outcome = result.current.create({ name: '   ', view: 'triage', filter: EMPTY_QUERY });
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();
    expect(result.current.views).toEqual([]);
    expect(persisted()).toBeNull();
  });

  it('rejects an over-long name without persisting', () => {
    const { result } = renderHook(() => useSavedViews());

    let outcome!: ReturnType<typeof result.current.create>;
    act(() => {
      outcome = result.current.create({
        name: 'a'.repeat(MAX_VIEW_NAME_LENGTH + 1),
        view: 'triage',
        filter: EMPTY_QUERY,
      });
    });

    expect(outcome.ok).toBe(false);
    expect(result.current.views).toEqual([]);
    expect(persisted()).toBeNull();
  });

  it('renames a view and persists the change', () => {
    const { result } = renderHook(() => useSavedViews());
    let created!: SavedView;
    act(() => {
      created = expectView(
        result.current.create({ name: 'Old', view: 'grid', filter: EMPTY_QUERY }),
      );
    });

    let outcome!: ReturnType<typeof result.current.rename>;
    act(() => {
      outcome = result.current.rename(created.id, 'New');
    });

    expect(outcome.ok).toBe(true);
    expect(result.current.views[0].name).toBe('New');
    expect(persisted()?.views[0].name).toBe('New');
  });

  it('reports rename failure when persistence is unavailable', () => {
    const { result } = renderHook(() => useSavedViews());
    let created!: SavedView;
    act(() => {
      created = expectView(
        result.current.create({ name: 'Old', view: 'grid', filter: EMPTY_QUERY }),
      );
    });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    let outcome!: ReturnType<typeof result.current.rename>;
    act(() => {
      outcome = result.current.rename(created.id, 'New');
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();
    expect(result.current.views[0].name).toBe('Old');
    expect(persisted()?.views[0].name).toBe('Old');
  });

  it('rejects an invalid rename without persisting', () => {
    const { result } = renderHook(() => useSavedViews());
    let created!: SavedView;
    act(() => {
      created = expectView(
        result.current.create({ name: 'Keep', view: 'grid', filter: EMPTY_QUERY }),
      );
    });

    let outcome!: ReturnType<typeof result.current.rename>;
    act(() => {
      outcome = result.current.rename(created.id, '');
    });

    expect(outcome.ok).toBe(false);
    expect(result.current.views[0].name).toBe('Keep');
    expect(persisted()?.views[0].name).toBe('Keep');
  });

  it('removes a view and persists the change', () => {
    const { result } = renderHook(() => useSavedViews());
    let created!: SavedView;
    act(() => {
      created = expectView(
        result.current.create({ name: 'Gone', view: 'inbox', filter: EMPTY_QUERY }),
      );
    });

    let outcome!: ReturnType<typeof result.current.remove>;
    act(() => {
      outcome = result.current.remove(created.id);
    });

    expect(outcome.ok).toBe(true);
    expect(result.current.views).toEqual([]);
    expect(persisted()?.views).toEqual([]);
  });

  it('reports remove failure when persistence is unavailable', () => {
    const { result } = renderHook(() => useSavedViews());
    let created!: SavedView;
    act(() => {
      created = expectView(
        result.current.create({ name: 'Keep', view: 'inbox', filter: EMPTY_QUERY }),
      );
    });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    let outcome!: ReturnType<typeof result.current.remove>;
    act(() => {
      outcome = result.current.remove(created.id);
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();
    expect(result.current.views).toHaveLength(1);
    expect(persisted()?.views).toHaveLength(1);
  });

  it('updates a view via patch and persists', () => {
    const { result } = renderHook(() => useSavedViews());
    let created!: SavedView;
    act(() => {
      created = expectView(
        result.current.create({ name: 'Patch', view: 'grid', filter: EMPTY_QUERY }),
      );
    });

    let outcome!: ReturnType<typeof result.current.update>;
    act(() => {
      outcome = result.current.update(created.id, { filter: ALT_QUERY, view: 'matrix' });
    });

    expect(outcome.ok).toBe(true);
    expect(result.current.find(created.id)?.view).toBe('matrix');
    expect(persisted()?.views[0].filter).toEqual(ALT_QUERY);
  });

  it('rejects an invalid update name without persisting and returns an error', () => {
    const { result } = renderHook(() => useSavedViews());
    let created!: SavedView;
    act(() => {
      created = expectView(
        result.current.create({ name: 'Keep', view: 'grid', filter: EMPTY_QUERY }),
      );
    });

    let outcome!: ReturnType<typeof result.current.update>;
    act(() => {
      outcome = result.current.update(created.id, { name: '' });
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();
    expect(result.current.views[0].name).toBe('Keep');
    expect(persisted()?.views[0].name).toBe('Keep');
  });

  it('loads a previously persisted state on mount', () => {
    const seed: SavedViewsState = {
      version: 1,
      views: [
        {
          id: 'seed-1',
          name: 'Seeded',
          view: 'triage',
          filter: EMPTY_QUERY,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    localStorage.setItem(STORAGE_KEY_V1, JSON.stringify(seed));

    const { result } = renderHook(() => useSavedViews());
    expect(result.current.views).toHaveLength(1);
    expect(result.current.views[0].name).toBe('Seeded');
  });

  it('returns ok:false when the MAX_SAVED_VIEWS cap is reached', () => {
    const seed: SavedViewsState = {
      version: 1,
      views: Array.from({ length: MAX_SAVED_VIEWS }, (_, i) => ({
        id: `seed-${i}`,
        name: `View ${i}`,
        view: 'triage' as const,
        filter: EMPTY_QUERY,
        createdAt: '2026-01-01T00:00:00.000Z',
      })),
    };
    localStorage.setItem(STORAGE_KEY_V1, JSON.stringify(seed));

    const { result } = renderHook(() => useSavedViews());
    let outcome!: ReturnType<typeof result.current.create>;
    act(() => {
      outcome = result.current.create({ name: 'One Too Many', view: 'grid', filter: EMPTY_QUERY });
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();
    expect(result.current.views).toHaveLength(MAX_SAVED_VIEWS);
    expect(persisted()?.views).toHaveLength(MAX_SAVED_VIEWS);
  });

  it('returns ok:false when the rename id is not found', () => {
    const { result } = renderHook(() => useSavedViews());

    let outcome!: ReturnType<typeof result.current.rename>;
    act(() => {
      outcome = result.current.rename('nonexistent-id', 'X');
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();
  });

  it('returns ok:false when the remove id is not found', () => {
    const { result } = renderHook(() => useSavedViews());

    let outcome!: ReturnType<typeof result.current.remove>;
    act(() => {
      outcome = result.current.remove('nonexistent-id');
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();
    expect(result.current.views).toEqual([]); // unchanged
  });

  it('reports update failure when persistence is unavailable', () => {
    const { result } = renderHook(() => useSavedViews());
    let created!: SavedView;
    act(() => {
      created = expectView(
        result.current.create({ name: 'Patch', view: 'grid', filter: EMPTY_QUERY }),
      );
    });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    let outcome!: ReturnType<typeof result.current.update>;
    act(() => {
      outcome = result.current.update(created.id, { filter: ALT_QUERY });
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();
    expect(result.current.find(created.id)?.filter).toEqual(EMPTY_QUERY);
    expect(persisted()?.views[0].filter).toEqual(EMPTY_QUERY);
  });
});
