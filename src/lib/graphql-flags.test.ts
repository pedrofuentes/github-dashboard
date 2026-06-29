import { describe, expect, it } from 'vitest';

import type { TileSignalType } from '../types/dashboard';

describe('graphql-flags', () => {
  it('exports the GraphQL enabled signal set derived from GRAPHQL_SIGNAL_FLAGS', async () => {
    const flagsModule = (await import('./graphql-flags')) as unknown as {
      GRAPHQL_SIGNAL_FLAGS?: Record<TileSignalType, boolean>;
      GRAPHQL_ENABLED_SIGNALS?: TileSignalType[];
    };

    expect(flagsModule.GRAPHQL_SIGNAL_FLAGS).toBeDefined();
    // Concrete-value oracle: hard-code the expected enabled set so a symmetric
    // entries→filter→map refactor bug can't stay green by recomputing the impl.
    expect(flagsModule.GRAPHQL_ENABLED_SIGNALS).toEqual([
      'ci',
      'reviews',
      'pullRequests',
      'issues',
      'stale',
    ]);
    expect(flagsModule.GRAPHQL_ENABLED_SIGNALS).not.toContain('security');
    expect(flagsModule.GRAPHQL_ENABLED_SIGNALS).not.toContain('activity');
  });
});
