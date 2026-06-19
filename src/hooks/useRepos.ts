/**
 * Data hook that adapts the GitHub client's `fetchUserRepos` data source into
 * typed {@link Repo} rows with explicit loading / success / error states.
 *
 * `fetchUserRepos` returns dropdown-style `DataSourceItem[]` (a leftover of the
 * Stream Deck origin): real repos carry `owner/repo` in `value`, private repos
 * prefix their label with a lock, and empty/error conditions arrive as a single
 * disabled item (errors prefixed with a warning sign). `interpretRepoItems`
 * encapsulates that translation and is exported for direct unit testing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchUserRepos, type DataSourceItem } from '../api/github';
import type { Repo } from '../types/fleet';

/** Loading lifecycle for the repo fetch. */
export type ReposStatus = 'loading' | 'success' | 'error';

/** Public shape returned by {@link useRepos}. */
export interface UseReposResult {
  status: ReposStatus;
  repos: Repo[];
  error: string | null;
  reload: () => void;
}

function parseRepo(item: DataSourceItem): Repo {
  const slash = item.value.indexOf('/');
  return {
    nameWithOwner: item.value,
    owner: slash >= 0 ? item.value.slice(0, slash) : item.value,
    name: slash >= 0 ? item.value.slice(slash + 1) : '',
    isPrivate: item.label.startsWith('🔒'),
  };
}

/**
 * Translates the data source items into repos plus an optional error message.
 * Real repos win: any disabled placeholder is ignored when repos are present.
 * Otherwise a warning item becomes an error and a plain placeholder is treated
 * as an empty (non-error) result.
 */
export function interpretRepoItems(items: DataSourceItem[]): {
  repos: Repo[];
  error: string | null;
} {
  const real = items.filter((item) => item.disabled !== true && item.value !== '');
  if (real.length > 0) {
    return { repos: real.map(parseRepo), error: null };
  }
  const warning = items.find((item) => item.label.startsWith('⚠'));
  return { repos: [], error: warning ? warning.label : null };
}

/**
 * Fetches the authenticated user's repos for `token`, refetching when the token
 * changes or {@link UseReposResult.reload} is called. A generation ref guards
 * against out-of-order responses from superseded tokens.
 */
export function useRepos(token: string | null): UseReposResult {
  const [status, setStatus] = useState<ReposStatus>(token ? 'loading' : 'success');
  const [repos, setRepos] = useState<Repo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadIndex, setReloadIndex] = useState(0);
  const generationRef = useRef(0);

  const reload = useCallback(() => {
    setReloadIndex((index) => index + 1);
  }, []);

  useEffect(() => {
    const generation = (generationRef.current += 1);

    if (!token) {
      setStatus('success');
      setRepos([]);
      setError(null);
      return;
    }

    setStatus('loading');
    setError(null);

    fetchUserRepos(token)
      .then((items) => {
        if (generation !== generationRef.current) {
          return;
        }
        const result = interpretRepoItems(items);
        if (result.error !== null) {
          setStatus('error');
          setError(result.error);
          setRepos([]);
        } else {
          setStatus('success');
          setRepos(result.repos);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (generation !== generationRef.current) {
          return;
        }
        setStatus('error');
        setError(cause instanceof Error ? cause.message : 'Failed to load repositories.');
        setRepos([]);
      });
  }, [token, reloadIndex]);

  return { status, repos, error, reload };
}
