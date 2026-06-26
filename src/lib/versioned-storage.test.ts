import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createVersionedStore } from './versioned-storage';

const KEY = 'fleet:test-store:v1';

const Schema = z.object({
  version: z.literal(1),
  items: z.array(z.string().min(1)).max(100),
});

type Value = z.infer<typeof Schema>;

const fallback = (): Value => ({ version: 1, items: [] });

function makeStore() {
  return createVersionedStore<Value>({ key: KEY, schema: Schema, fallback });
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('createVersionedStore — load', () => {
  it('returns a fresh fallback when the key is missing', () => {
    const store = makeStore();
    expect(store.load()).toEqual({ version: 1, items: [] });
  });

  it('returns a distinct fallback instance on each call', () => {
    const store = makeStore();
    const a = store.load();
    const b = store.load();
    expect(a).not.toBe(b);
  });

  it('returns the fallback when the stored JSON is corrupt', () => {
    localStorage.setItem(KEY, '{not valid json');
    expect(makeStore().load()).toEqual({ version: 1, items: [] });
  });

  it('returns the fallback when the stored payload fails schema validation', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 2, items: 'nope' }));
    expect(makeStore().load()).toEqual({ version: 1, items: [] });
  });

  it('returns the validated value when the stored payload is valid', () => {
    const value: Value = { version: 1, items: ['a', 'b'] };
    localStorage.setItem(KEY, JSON.stringify(value));
    expect(makeStore().load()).toEqual(value);
  });

  it('returns the fallback when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(makeStore().load()).toEqual({ version: 1, items: [] });
  });
});

describe('createVersionedStore — migrate', () => {
  it('runs migrate before validation to upgrade a legacy payload', () => {
    // Legacy: bare array of strings, no version envelope.
    localStorage.setItem(KEY, JSON.stringify(['x', 'y']));
    const migrate = vi.fn((raw: unknown): unknown => {
      if (Array.isArray(raw)) return { version: 1, items: raw };
      return raw;
    });
    const store = createVersionedStore<Value>({ key: KEY, schema: Schema, fallback, migrate });
    expect(store.load()).toEqual({ version: 1, items: ['x', 'y'] });
    expect(migrate).toHaveBeenCalledWith(['x', 'y']);
  });

  it('falls back when migrate yields a still-invalid payload', () => {
    localStorage.setItem(KEY, JSON.stringify({ legacy: true }));
    const migrate = (raw: unknown): unknown => raw;
    const store = createVersionedStore<Value>({ key: KEY, schema: Schema, fallback, migrate });
    expect(store.load()).toEqual({ version: 1, items: [] });
  });

  it('falls back without throwing when migrate itself throws', () => {
    localStorage.setItem(KEY, JSON.stringify(['x', 'y']));
    const migrate = vi.fn((): unknown => {
      throw new Error('migrate boom');
    });
    const store = createVersionedStore<Value>({ key: KEY, schema: Schema, fallback, migrate });
    expect(() => store.load()).not.toThrow();
    expect(store.load()).toEqual({ version: 1, items: [] });
    expect(migrate).toHaveBeenCalledWith(['x', 'y']);
  });
});

describe('createVersionedStore — save', () => {
  it('writes a valid value as JSON', () => {
    const value: Value = { version: 1, items: ['a'] };
    expect(makeStore().save(value)).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual(value);
  });

  it('skips the write when the value fails schema validation', () => {
    const store = makeStore();
    // Bypass the type system to feed an invalid value, as a corrupt caller might.
    expect(store.save({ version: 1, items: [123] } as unknown as Value)).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('reports failure and persists nothing when localStorage.setItem throws', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    const value: Value = { version: 1, items: ['a'] };
    expect(makeStore().save(value)).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('createVersionedStore — clear', () => {
  it('removes the persisted key', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, items: ['a'] }));
    makeStore().clear();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('attempts removal but leaves the item when localStorage.removeItem throws', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, items: ['a'] }));
    const removeItem = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(() => makeStore().clear()).not.toThrow();
    expect(removeItem).toHaveBeenCalledWith(KEY);
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });
});
