import { describe, expect, it } from 'vitest';

import { isAbortError } from './abort';

describe('isAbortError', () => {
  it('recognizes a DOMException named AbortError (what fetch rejects with)', () => {
    expect(isAbortError(new DOMException('The operation was aborted', 'AbortError'))).toBe(true);
  });

  it('recognizes any Error whose name is AbortError', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(isAbortError(err)).toBe(true);
  });

  it('recognizes a plain object carrying name: AbortError', () => {
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
  });

  it('returns false for an ordinary error', () => {
    expect(isAbortError(new Error('boom'))).toBe(false);
    expect(isAbortError(new TypeError('network'))).toBe(false);
  });

  it('returns false for an error with a different name', () => {
    expect(isAbortError(new DOMException('timed out', 'TimeoutError'))).toBe(false);
  });

  it('returns false for non-object values', () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
    expect(isAbortError(42)).toBe(false);
  });
});
