import { describe, expect, it } from 'vitest';

import type { TileSignalType } from '../types/dashboard';

describe('graphql-flags', () => {
  it('exports the GraphQL enabled signal set derived from GRAPHQL_SIGNAL_FLAGS', async () => {
    const flagsModule = (await import('./graphql-flags')) as unknown as {
      GRAPHQL_SIGNAL_FLAGS?: Record<TileSignalType, boolean>;
      GRAPHQL_ENABLED_SIGNALS?: TileSignalType[];
    };

    expect(flagsModule.GRAPHQL_SIGNAL_FLAGS).toBeDefined();
    expect(flagsModule.GRAPHQL_ENABLED_SIGNALS).toEqual(
      Object.entries(flagsModule.GRAPHQL_SIGNAL_FLAGS ?? {})
        .filter(([, enabled]) => enabled)
        .map(([signal]) => signal),
    );
  });
});
