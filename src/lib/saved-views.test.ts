/**
 * Tests for saved-views model + persistence (pure lib, no UI).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SavedViewSchema,
  SavedViewsStateSchema,
  createSavedView,
  addSavedView,
  removeSavedView,
  renameSavedView,
  updateSavedView,
  findSavedView,
  createSavedViewsStore,
  validateSavedViewName,
  MAX_SAVED_VIEWS,
  MAX_VIEW_NAME_LENGTH,
  STORAGE_KEY_V1,
} from './saved-views';
import { EMPTY_QUERY } from './repo-filter-query';
import { FLEET_VIEWS } from './view-preference';

function expectState<T>(state: T | null): T {
  expect(state).not.toBeNull();
  if (state === null) {
    throw new Error('expected saved-views operation to return state');
  }
  return state;
}

describe('validateSavedViewName', () => {
  it('rejects empty string', () => {
    expect(validateSavedViewName('')).toBe('Enter a name for this view.');
  });

  it('rejects whitespace-only string', () => {
    expect(validateSavedViewName('   ')).toBe('Enter a name for this view.');
  });

  it('rejects name over MAX_VIEW_NAME_LENGTH', () => {
    const longName = 'a'.repeat(MAX_VIEW_NAME_LENGTH + 1);
    expect(validateSavedViewName(longName)).toBe(
      `Name must be ${MAX_VIEW_NAME_LENGTH} characters or fewer.`,
    );
  });

  it('accepts a valid name', () => {
    expect(validateSavedViewName('My view')).toBeNull();
  });

  it('rejects names containing control characters (U+0000–U+001F)', () => {
    expect(validateSavedViewName('View\x00Name')).not.toBeNull(); // NULL
    expect(validateSavedViewName('View\x01Name')).not.toBeNull(); // SOH
    expect(validateSavedViewName('View\x0AName')).not.toBeNull(); // LF
    expect(validateSavedViewName('View\x0DName')).not.toBeNull(); // CR
    expect(validateSavedViewName('View\x1FName')).not.toBeNull(); // US
  });

  it('rejects names containing DEL control character (U+007F)', () => {
    expect(validateSavedViewName('View\x7FName')).not.toBeNull();
  });

  it('rejects names containing bidi override characters', () => {
    expect(validateSavedViewName('View\u202EName')).not.toBeNull(); // RIGHT-TO-LEFT OVERRIDE
    expect(validateSavedViewName('View\u202DName')).not.toBeNull(); // LEFT-TO-RIGHT OVERRIDE
    expect(validateSavedViewName('View\u2066Name')).not.toBeNull(); // LEFT-TO-RIGHT ISOLATE
    expect(validateSavedViewName('View\u2067Name')).not.toBeNull(); // RIGHT-TO-LEFT ISOLATE
  });

  it('rejects names containing zero-width characters', () => {
    expect(validateSavedViewName('View\u200BName')).not.toBeNull(); // ZERO WIDTH SPACE
    expect(validateSavedViewName('View\u200CName')).not.toBeNull(); // ZERO WIDTH NON-JOINER
    expect(validateSavedViewName('View\u200DName')).not.toBeNull(); // ZERO WIDTH JOINER
    expect(validateSavedViewName('View\uFEFFName')).not.toBeNull(); // ZERO WIDTH NO-BREAK SPACE
  });
});

describe('SavedView schema validation', () => {
  it('accepts a valid SavedView', () => {
    const valid = {
      id: 'test-id-1',
      name: 'My Triage View',
      view: 'triage' as const,
      filter: EMPTY_QUERY,
      createdAt: '2026-06-22T00:00:00.000Z',
    };
    expect(SavedViewSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a SavedView with optional sort', () => {
    const withSort = {
      id: 'test-id-2',
      name: 'Grid with Sort',
      view: 'grid' as const,
      filter: EMPTY_QUERY,
      sort: { columnId: 'owner', direction: 'asc' as const },
      createdAt: '2026-06-22T00:00:00.000Z',
    };
    expect(SavedViewSchema.safeParse(withSort).success).toBe(true);
  });

  it('accepts a SavedView with optional density', () => {
    const withDensity = {
      id: 'test-id-3',
      name: 'Matrix Glanceable',
      view: 'matrix' as const,
      filter: EMPTY_QUERY,
      density: 'glanceable' as const,
      createdAt: '2026-06-22T00:00:00.000Z',
    };
    expect(SavedViewSchema.safeParse(withDensity).success).toBe(true);
  });

  it('accepts a SavedView targeting the deck view', () => {
    const deckView = {
      id: 'test-id-deck',
      name: 'Deck Board',
      view: 'deck' as const,
      filter: EMPTY_QUERY,
      createdAt: '2026-06-22T00:00:00.000Z',
    };
    expect(SavedViewSchema.safeParse(deckView).success).toBe(true);
  });

  it('accepts every FleetView value from the single source of truth', () => {
    for (const view of FLEET_VIEWS) {
      expect(
        SavedViewSchema.safeParse({
          id: `test-id-${view}`,
          name: `${view} view`,
          view,
          filter: EMPTY_QUERY,
          createdAt: '2026-06-22T00:00:00.000Z',
        }).success,
      ).toBe(true);
    }
  });

  it('rejects SavedView with invalid view', () => {
    const invalid = {
      id: 'test-id-4',
      name: 'Bad View',
      view: 'invalid-view',
      filter: EMPTY_QUERY,
      createdAt: '2026-06-22T00:00:00.000Z',
    };
    expect(SavedViewSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects SavedView with name exceeding MAX_VIEW_NAME_LENGTH', () => {
    const longName = 'a'.repeat(MAX_VIEW_NAME_LENGTH + 1);
    const invalid = {
      id: 'test-id-5',
      name: longName,
      view: 'triage' as const,
      filter: EMPTY_QUERY,
      createdAt: '2026-06-22T00:00:00.000Z',
    };
    expect(SavedViewSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects SavedView with invalid filter query', () => {
    const invalid = {
      id: 'test-id-6',
      name: 'Bad Filter',
      view: 'grid' as const,
      filter: { version: 999, text: '', repoSelection: null, facets: null },
      createdAt: '2026-06-22T00:00:00.000Z',
    };
    expect(SavedViewSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects SavedView with invalid sort direction', () => {
    const invalid = {
      id: 'test-id-7',
      name: 'Bad Sort',
      view: 'grid' as const,
      filter: EMPTY_QUERY,
      sort: { columnId: 'owner', direction: 'sideways' },
      createdAt: '2026-06-22T00:00:00.000Z',
    };
    expect(SavedViewSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects SavedView with invalid density', () => {
    const invalid = {
      id: 'test-id-8',
      name: 'Bad Density',
      view: 'matrix' as const,
      filter: EMPTY_QUERY,
      density: 'super-dense',
      createdAt: '2026-06-22T00:00:00.000Z',
    };
    expect(SavedViewSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('SavedViewsStateSchema validation', () => {
  it('accepts a valid empty state', () => {
    const valid = { version: 1, views: [] };
    expect(SavedViewsStateSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a state with valid views', () => {
    const valid = {
      version: 1,
      views: [
        {
          id: 'view-1',
          name: 'View 1',
          view: 'triage' as const,
          filter: EMPTY_QUERY,
          createdAt: '2026-06-22T00:00:00.000Z',
        },
        {
          id: 'view-2',
          name: 'View 2',
          view: 'grid' as const,
          filter: EMPTY_QUERY,
          createdAt: '2026-06-22T00:00:00.000Z',
        },
      ],
    };
    expect(SavedViewsStateSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects state with views exceeding MAX_SAVED_VIEWS', () => {
    const tooMany = {
      version: 1,
      views: Array.from({ length: MAX_SAVED_VIEWS + 1 }, (_, i) => ({
        id: `view-${i}`,
        name: `View ${i}`,
        view: 'triage' as const,
        filter: EMPTY_QUERY,
        createdAt: '2026-06-22T00:00:00.000Z',
      })),
    };
    expect(SavedViewsStateSchema.safeParse(tooMany).success).toBe(false);
  });

  it('rejects state with wrong version', () => {
    const invalid = { version: 999, views: [] };
    expect(SavedViewsStateSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('createSavedView', () => {
  it('fills id and createdAt with provided generators', () => {
    const mockId = vi.fn(() => 'mock-id-123');
    const mockClock = vi.fn(() => '2026-06-22T12:34:56.789Z');

    const view = createSavedView(
      {
        name: 'Test View',
        view: 'triage',
        filter: EMPTY_QUERY,
      },
      mockId,
      mockClock,
    );

    expect(mockId).toHaveBeenCalledOnce();
    expect(mockClock).toHaveBeenCalledOnce();
    expect(view).toEqual({
      id: 'mock-id-123',
      name: 'Test View',
      view: 'triage',
      filter: EMPTY_QUERY,
      createdAt: '2026-06-22T12:34:56.789Z',
    });
  });

  it('includes optional sort when provided', () => {
    const mockId = () => 'id-1';
    const mockClock = () => '2026-06-22T00:00:00.000Z';

    const view = createSavedView(
      {
        name: 'Sorted Grid',
        view: 'grid',
        filter: EMPTY_QUERY,
        sort: { columnId: 'name', direction: 'desc' },
      },
      mockId,
      mockClock,
    );

    expect(view.sort).toEqual({ columnId: 'name', direction: 'desc' });
  });

  it('includes optional density when provided', () => {
    const mockId = () => 'id-2';
    const mockClock = () => '2026-06-22T00:00:00.000Z';

    const view = createSavedView(
      {
        name: 'Dense Matrix',
        view: 'matrix',
        filter: EMPTY_QUERY,
        density: 'balanced',
      },
      mockId,
      mockClock,
    );

    expect(view.density).toBe('balanced');
  });
});

describe('addSavedView', () => {
  const baseState = { version: 1 as const, views: [] };
  const mockView = {
    id: 'view-1',
    name: 'View 1',
    view: 'triage' as const,
    filter: EMPTY_QUERY,
    createdAt: '2026-06-22T00:00:00.000Z',
  };

  it('adds a view to empty state', () => {
    const newState = expectState(addSavedView(baseState, mockView));
    expect(newState.views).toHaveLength(1);
    expect(newState.views[0]).toEqual(mockView);
    expect(baseState.views).toHaveLength(0); // immutable
  });

  it('adds a view to non-empty state', () => {
    const stateWithOne = { version: 1 as const, views: [mockView] };
    const newView = { ...mockView, id: 'view-2', name: 'View 2' };
    const newState = expectState(addSavedView(stateWithOne, newView));
    expect(newState.views).toHaveLength(2);
    expect(stateWithOne.views).toHaveLength(1); // immutable
  });

  it('enforces MAX_SAVED_VIEWS cap by rejecting new view', () => {
    const fullState = {
      version: 1 as const,
      views: Array.from({ length: MAX_SAVED_VIEWS }, (_, i) => ({
        id: `view-${i}`,
        name: `View ${i}`,
        view: 'triage' as const,
        filter: EMPTY_QUERY,
        createdAt: '2026-06-22T00:00:00.000Z',
      })),
    };
    const newView = { ...mockView, id: 'overflow' };
    const newState = addSavedView(fullState, newView);
    expect(newState).toBeNull();
    expect(fullState.views.find((v) => v.id === 'overflow')).toBeUndefined();
  });

  it('does not add duplicate id', () => {
    const stateWithOne = { version: 1 as const, views: [mockView] };
    const duplicate = { ...mockView, name: 'Different Name' };
    const newState = addSavedView(stateWithOne, duplicate);
    expect(newState).toBeNull();
    expect(stateWithOne.views[0].name).toBe('View 1'); // unchanged
  });

  it('rejects a view that fails schema validation', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invalid = { ...mockView, id: '' } as any;
    const newState = addSavedView(baseState, invalid);
    expect(newState).toBeNull();
    expect(baseState.views).toHaveLength(0); // state unchanged
  });
});

describe('removeSavedView', () => {
  const view1 = {
    id: 'view-1',
    name: 'View 1',
    view: 'triage' as const,
    filter: EMPTY_QUERY,
    createdAt: '2026-06-22T00:00:00.000Z',
  };
  const view2 = {
    id: 'view-2',
    name: 'View 2',
    view: 'grid' as const,
    filter: EMPTY_QUERY,
    createdAt: '2026-06-22T00:00:00.000Z',
  };
  const state = { version: 1 as const, views: [view1, view2] };

  it('removes a view by id', () => {
    const newState = expectState(removeSavedView(state, 'view-1'));
    expect(newState.views).toHaveLength(1);
    expect(newState.views[0].id).toBe('view-2');
    expect(state.views).toHaveLength(2); // immutable
  });

  it('returns unchanged state when id not found', () => {
    const newState = removeSavedView(state, 'nonexistent');
    expect(newState).toBeNull();
    expect(state.views).toHaveLength(2);
  });

  it('handles removing from single-view state', () => {
    const singleState = { version: 1 as const, views: [view1] };
    const newState = expectState(removeSavedView(singleState, 'view-1'));
    expect(newState.views).toHaveLength(0);
  });
});

describe('renameSavedView', () => {
  const view1 = {
    id: 'view-1',
    name: 'Old Name',
    view: 'triage' as const,
    filter: EMPTY_QUERY,
    createdAt: '2026-06-22T00:00:00.000Z',
  };
  const state = { version: 1 as const, views: [view1] };

  it('renames a view by id', () => {
    const newState = expectState(renameSavedView(state, 'view-1', 'New Name'));
    expect(newState.views[0].name).toBe('New Name');
    expect(state.views[0].name).toBe('Old Name'); // immutable
  });

  it('returns unchanged state when id not found', () => {
    const newState = renameSavedView(state, 'nonexistent', 'New Name');
    expect(newState).toBeNull();
    expect(state.views[0].name).toBe('Old Name');
  });

  it('rejects an invalid name without producing invalid state', () => {
    const newState = renameSavedView(state, 'view-1', '');
    expect(newState).toBeNull();
    expect(state.views[0].name).toBe('Old Name');
  });

  it('handles renaming among multiple views', () => {
    const view2 = { ...view1, id: 'view-2', name: 'Another View' };
    const multiState = { version: 1 as const, views: [view1, view2] };
    const newState = expectState(renameSavedView(multiState, 'view-2', 'Renamed'));
    expect(newState.views[0].name).toBe('Old Name');
    expect(newState.views[1].name).toBe('Renamed');
  });
});

describe('updateSavedView', () => {
  const view1 = {
    id: 'view-1',
    name: 'View 1',
    view: 'triage' as const,
    filter: EMPTY_QUERY,
    createdAt: '2026-06-22T00:00:00.000Z',
  };
  const state = { version: 1 as const, views: [view1] };

  it('updates view with patch', () => {
    const newState = expectState(
      updateSavedView(state, 'view-1', {
        view: 'grid',
        sort: { columnId: 'owner', direction: 'asc' },
      }),
    );
    expect(newState.views[0].view).toBe('grid');
    expect(newState.views[0].sort).toEqual({ columnId: 'owner', direction: 'asc' });
    expect(newState.views[0].name).toBe('View 1'); // unchanged
    expect(state.views[0].view).toBe('triage'); // immutable
  });

  it('returns unchanged state when id not found', () => {
    const newState = updateSavedView(state, 'nonexistent', { view: 'grid' });
    expect(newState).toBeNull();
    expect(state.views[0]).toEqual(view1);
  });

  it('rejects an invalid name patch without producing invalid state', () => {
    const newState = updateSavedView(state, 'view-1', { name: '' });
    expect(newState).toBeNull();
    expect(state.views[0].name).toBe('View 1');
  });

  it('can update filter', () => {
    const newFilter = { ...EMPTY_QUERY, text: 'search-term' };
    const newState = expectState(updateSavedView(state, 'view-1', { filter: newFilter }));
    expect(newState.views[0].filter.text).toBe('search-term');
  });

  it('can update density', () => {
    const newState = expectState(updateSavedView(state, 'view-1', { density: 'glanceable' }));
    expect(newState.views[0].density).toBe('glanceable');
  });

  it('rejects a patch that produces an invalid schema', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newState = updateSavedView(state, 'view-1', { view: 'not-a-valid-view' } as any);
    expect(newState).toBeNull();
    expect(state.views[0]).toEqual(view1); // state unchanged
  });
});

describe('findSavedView', () => {
  const view1 = {
    id: 'view-1',
    name: 'View 1',
    view: 'triage' as const,
    filter: EMPTY_QUERY,
    createdAt: '2026-06-22T00:00:00.000Z',
  };
  const view2 = {
    id: 'view-2',
    name: 'View 2',
    view: 'grid' as const,
    filter: EMPTY_QUERY,
    createdAt: '2026-06-22T00:00:00.000Z',
  };
  const state = { version: 1 as const, views: [view1, view2] };

  it('finds a view by id', () => {
    const found = findSavedView(state, 'view-1');
    expect(found).toEqual(view1);
  });

  it('returns undefined when id not found', () => {
    const found = findSavedView(state, 'nonexistent');
    expect(found).toBeUndefined();
  });

  it('finds correct view among multiple', () => {
    const found = findSavedView(state, 'view-2');
    expect(found).toEqual(view2);
  });
});

describe('persistence via createSavedViewsStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads empty fallback when no data exists', () => {
    const store = createSavedViewsStore();
    const state = store.load();
    expect(state).toEqual({ version: 1, views: [] });
  });

  it('saves and loads a state', () => {
    const store = createSavedViewsStore();
    const view = {
      id: 'view-1',
      name: 'Saved View',
      view: 'triage' as const,
      filter: EMPTY_QUERY,
      createdAt: '2026-06-22T00:00:00.000Z',
    };
    const state = { version: 1 as const, views: [view] };
    expect(store.save(state)).toBe(true);
    const loaded = store.load();
    expect(loaded).toEqual(state);
  });

  it('degrades to fallback on corrupt data', () => {
    const store = createSavedViewsStore();
    localStorage.setItem(STORAGE_KEY_V1, 'not-valid-json{{{');
    const loaded = store.load();
    expect(loaded).toEqual({ version: 1, views: [] });
  });

  it('degrades to fallback on invalid schema', () => {
    const store = createSavedViewsStore();
    localStorage.setItem(STORAGE_KEY_V1, JSON.stringify({ version: 999, views: null }));
    const loaded = store.load();
    expect(loaded).toEqual({ version: 1, views: [] });
  });

  it('clears persisted data', () => {
    const store = createSavedViewsStore();
    const view = {
      id: 'view-1',
      name: 'View',
      view: 'triage' as const,
      filter: EMPTY_QUERY,
      createdAt: '2026-06-22T00:00:00.000Z',
    };
    store.save({ version: 1, views: [view] });
    store.clear();
    const loaded = store.load();
    expect(loaded).toEqual({ version: 1, views: [] });
  });

  it('rejects save of invalid state', () => {
    const store = createSavedViewsStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invalid = { version: 1 as const, views: [{ id: 'bad', name: '' }] } as any;
    expect(store.save(invalid)).toBe(false);
    const loaded = store.load();
    expect(loaded).toEqual({ version: 1, views: [] }); // fallback, not saved
  });
});
