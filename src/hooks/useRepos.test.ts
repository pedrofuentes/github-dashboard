import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchUserRepos, type DataSourceItem } from '../api/github';
import { interpretRepoItems, useRepos } from './useRepos';

vi.mock('../api/github', () => ({
  fetchUserRepos: vi.fn(),
}));

const mockFetchUserRepos = vi.mocked(fetchUserRepos);

beforeEach(() => {
  mockFetchUserRepos.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('interpretRepoItems', () => {
  it('parses real repo items into Repo objects', () => {
    const { repos, error } = interpretRepoItems([
      { label: 'octo/public', value: 'octo/public' },
      { label: '🔒 acme/secret', value: 'acme/secret' },
    ]);

    expect(error).toBeNull();
    expect(repos).toEqual([
      { nameWithOwner: 'octo/public', owner: 'octo', name: 'public', isPrivate: false },
      { nameWithOwner: 'acme/secret', owner: 'acme', name: 'secret', isPrivate: true },
    ]);
  });

  it('treats a "no repositories" placeholder as an empty (not error) result', () => {
    expect(
      interpretRepoItems([{ label: 'No repositories found', value: '', disabled: true }]),
    ).toEqual({ repos: [], error: null });
  });

  it('surfaces a warning item as an error message', () => {
    expect(
      interpretRepoItems([{ label: '⚠ Invalid or expired token', value: '', disabled: true }]),
    ).toEqual({ repos: [], error: '⚠ Invalid or expired token' });
  });

  it('ignores disabled items when real repos are present', () => {
    const { repos, error } = interpretRepoItems([
      { label: '⚠ partial failure', value: '', disabled: true },
      { label: 'octo/public', value: 'octo/public' },
    ]);
    expect(error).toBeNull();
    expect(repos.map((r) => r.nameWithOwner)).toEqual(['octo/public']);
  });
});

describe('useRepos', () => {
  it('starts loading, then resolves to the fetched repos', async () => {
    mockFetchUserRepos.mockResolvedValue([{ label: 'octo/a', value: 'octo/a' }]);

    const { result } = renderHook(() => useRepos('ghp_token'));
    expect(result.current.status).toBe('loading');

    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
    expect(result.current.repos).toEqual([
      { nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false },
    ]);
    expect(mockFetchUserRepos).toHaveBeenCalledWith('ghp_token');
  });

  it('exposes an error state when the client reports a warning', async () => {
    mockFetchUserRepos.mockResolvedValue([
      { label: '⚠ Invalid or expired token', value: '', disabled: true },
    ]);

    const { result } = renderHook(() => useRepos('ghp_token'));

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error).toMatch(/invalid or expired/i);
    expect(result.current.repos).toEqual([]);
  });

  it('exposes an error state when the fetch rejects', async () => {
    mockFetchUserRepos.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useRepos('ghp_token'));

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error).toBeTruthy();
  });

  it('refetches when reload is called', async () => {
    mockFetchUserRepos.mockResolvedValue([{ label: 'octo/a', value: 'octo/a' }]);

    const { result } = renderHook(() => useRepos('ghp_token'));
    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
    expect(mockFetchUserRepos).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.reload();
    });
    await waitFor(() => {
      expect(mockFetchUserRepos).toHaveBeenCalledTimes(2);
    });
  });

  it('does not fetch and resolves empty when there is no token', async () => {
    const { result } = renderHook(() => useRepos(null));

    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
    expect(result.current.repos).toEqual([]);
    expect(mockFetchUserRepos).not.toHaveBeenCalled();
  });

  it('refetches when the token changes', async () => {
    mockFetchUserRepos.mockResolvedValue([{ label: 'octo/a', value: 'octo/a' }]);

    const { rerender } = renderHook(({ token }) => useRepos(token), {
      initialProps: { token: 'ghp_one' },
    });
    await waitFor(() => {
      expect(mockFetchUserRepos).toHaveBeenCalledWith('ghp_one');
    });

    rerender({ token: 'ghp_two' });
    await waitFor(() => {
      expect(mockFetchUserRepos).toHaveBeenCalledWith('ghp_two');
    });
  });

  it('ignores stale successful response when token changes mid-flight', async () => {
    // Create deferred promises to control resolution order
    type ResolveFunc = (value: DataSourceItem[]) => void;
    let resolveToken1: ResolveFunc | undefined;
    let resolveToken2: ResolveFunc | undefined;
    const token1Promise = new Promise<DataSourceItem[]>((resolve) => {
      resolveToken1 = resolve;
    });
    const token2Promise = new Promise<DataSourceItem[]>((resolve) => {
      resolveToken2 = resolve;
    });

    mockFetchUserRepos.mockImplementation((token) => {
      if (token === 'ghp_token1') return token1Promise;
      if (token === 'ghp_token2') return token2Promise;
      return Promise.resolve([]);
    });

    // Start with token1
    const { result, rerender } = renderHook(({ token }) => useRepos(token), {
      initialProps: { token: 'ghp_token1' },
    });
    expect(result.current.status).toBe('loading');

    // Switch to token2 before token1 resolves
    rerender({ token: 'ghp_token2' });
    expect(result.current.status).toBe('loading');

    // Resolve token2 FIRST (the current token)
    act(() => {
      if (resolveToken2) {
        resolveToken2([{ label: 'acme/current', value: 'acme/current' }]);
      }
    });

    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
    expect(result.current.repos).toEqual([
      { nameWithOwner: 'acme/current', owner: 'acme', name: 'current', isPrivate: false },
    ]);

    // Now resolve the stale token1 promise
    act(() => {
      if (resolveToken1) {
        resolveToken1([{ label: 'octo/stale', value: 'octo/stale' }]);
      }
    });

    // Wait a tick to ensure any side effects would have fired
    await new Promise((resolve) => setTimeout(resolve, 10));

    // State should still reflect token2's data (generationRef guard prevented overwrite)
    expect(result.current.status).toBe('success');
    expect(result.current.repos).toEqual([
      { nameWithOwner: 'acme/current', owner: 'acme', name: 'current', isPrivate: false },
    ]);
  });

  it('ignores stale rejected response when token changes mid-flight', async () => {
    // Create deferred promises to control resolution order
    type ResolveFunc = (value: DataSourceItem[]) => void;
    type RejectFunc = (error: unknown) => void;
    let resolveToken2: ResolveFunc | undefined;
    let rejectToken1: RejectFunc | undefined;
    const token1Promise = new Promise<DataSourceItem[]>((_, reject) => {
      rejectToken1 = reject;
    });
    const token2Promise = new Promise<DataSourceItem[]>((resolve) => {
      resolveToken2 = resolve;
    });

    mockFetchUserRepos.mockImplementation((token) => {
      if (token === 'ghp_token1') return token1Promise;
      if (token === 'ghp_token2') return token2Promise;
      return Promise.resolve([]);
    });

    // Start with token1
    const { result, rerender } = renderHook(({ token }) => useRepos(token), {
      initialProps: { token: 'ghp_token1' },
    });
    expect(result.current.status).toBe('loading');

    // Switch to token2 before token1 resolves
    rerender({ token: 'ghp_token2' });
    expect(result.current.status).toBe('loading');

    // Resolve token2 FIRST (the current token) with success
    act(() => {
      if (resolveToken2) {
        resolveToken2([{ label: 'acme/current', value: 'acme/current' }]);
      }
    });

    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
    expect(result.current.repos).toEqual([
      { nameWithOwner: 'acme/current', owner: 'acme', name: 'current', isPrivate: false },
    ]);
    expect(result.current.error).toBeNull();

    // Now REJECT the stale token1 promise
    act(() => {
      if (rejectToken1) {
        rejectToken1(new Error('stale network failure'));
      }
    });

    // Wait a tick to ensure any side effects would have fired
    await new Promise((resolve) => setTimeout(resolve, 10));

    // State should still reflect token2's success (generationRef guard prevented error overwrite)
    expect(result.current.status).toBe('success');
    expect(result.current.repos).toEqual([
      { nameWithOwner: 'acme/current', owner: 'acme', name: 'current', isPrivate: false },
    ]);
    expect(result.current.error).toBeNull();
  });
});
