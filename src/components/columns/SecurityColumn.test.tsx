import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ReactElement } from 'react';

import type { Repo, RepoSignalData } from '../../types/fleet';
import { securityColumn } from './SecurityColumn';

const REPO: Repo = { nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false };

describe('securityColumn descriptor', () => {
  it('declares the centred, descending-sortable Security column', () => {
    expect(securityColumn.id).toBe('security');
    expect(securityColumn.header).toBe('Security');
    expect(securityColumn.align).toBe('center');
    expect(securityColumn.sortable).toBe(true);
    expect(securityColumn.defaultSortDirection).toBe('desc');
  });

  it('sorts by the security score and sinks repos without a score to -1', () => {
    expect(securityColumn.getSortValue?.(REPO, { security: { status: 'ready', score: 42 } })).toBe(
      42,
    );
    expect(securityColumn.getSortValue?.(REPO, {})).toBe(-1);
  });

  it('renders the SecurityCell for the row’s security slice', () => {
    const data: RepoSignalData = {
      security: {
        status: 'ready',
        score: 120,
        grade: 'F',
        counts: { critical: 1, high: 1, medium: 0, low: 0 },
      },
    };
    render(<>{securityColumn.render(REPO, data) as ReactElement}</>);
    expect(screen.getByText(/security grade f/i)).toBeInTheDocument();
  });
});
