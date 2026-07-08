import { useEffect, useState } from 'react';

import {
  getInstallState,
  promptInstall,
  subscribe,
  type InstallOutcome,
  type InstallState,
} from '../lib/install-prompt';

export interface UseInstallPrompt extends InstallState {
  promptInstall: () => Promise<InstallOutcome>;
}

/**
 * React binding for the PWA install-prompt module. Reflects whether a native
 * install prompt is available (`canInstall`) and whether the app is already
 * installed (`installed`), and exposes `promptInstall` to fire the native prompt.
 */
export function useInstallPrompt(): UseInstallPrompt {
  const [state, setState] = useState<InstallState>(getInstallState);

  useEffect(() => {
    // Sync once on mount in case the event fired before this effect ran, then
    // stay subscribed to future changes.
    setState(getInstallState());
    return subscribe(() => {
      setState(getInstallState());
    });
  }, []);

  return { ...state, promptInstall };
}
