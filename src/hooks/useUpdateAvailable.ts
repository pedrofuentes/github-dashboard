import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';

import { buildInfo } from '../lib/build-info';

export const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

const versionSchema = z.object({
  sha: z.string(),
  builtAt: z.string(),
});

export interface UpdateAvailability {
  updateAvailable: boolean;
  deployedSha: string | null;
}

export function useUpdateAvailable(): UpdateAvailability {
  const [state, setState] = useState<UpdateAvailability>({
    updateAvailable: false,
    deployedSha: null,
  });

  const checkForUpdate = useCallback(async (ignore: { current: boolean }) => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}version.json`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        return;
      }

      const parsed = versionSchema.parse(await response.json());
      if (!ignore.current) {
        setState({
          updateAvailable: parsed.sha !== buildInfo.sha,
          deployedSha: parsed.sha,
        });
      }
    } catch {
      // Update checks are advisory; network or deploy races should never interrupt use.
    }
  }, []);

  useEffect(() => {
    if (buildInfo.sha === 'dev') {
      return;
    }

    const ignore = { current: false };
    const runCheck = (): void => {
      void checkForUpdate(ignore);
    };
    const handleVisibilityChange = (): void => {
      if (!document.hidden) {
        runCheck();
      }
    };

    runCheck();
    const intervalId = window.setInterval(runCheck, UPDATE_CHECK_INTERVAL_MS);
    window.addEventListener('focus', runCheck);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      ignore.current = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', runCheck);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkForUpdate]);

  return state;
}
