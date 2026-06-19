import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ReactElement } from 'react';

import type { Repo, RepoSignalData } from '../../types/fleet';
import { ciColumn } from './CiColumn';

const repo: Repo = { nameWithOwner: 'octo/a', owner: 'octo', name: 'a', isPrivate: false };

function renderCell(data: RepoSignalData) {
  return render(<>{ciColumn.render(repo, data) as ReactElement}</>);
}

describe('ci column', () => {
  it('keeps its centered, descending-sort descriptor metadata', () => {
    expect(ciColumn.id).toBe('ci');
    expect(ciColumn.header).toBe('CI');
    expect(ciColumn.align).toBe('center');
    expect(ciColumn.sortable).toBe(true);
    expect(ciColumn.defaultSortDirection).toBe('desc');
    expect(ciColumn.isRowHeader).toBeFalsy();
  });

  it('sorts by the slice score so failures rise to the top under desc', () => {
    expect(ciColumn.getSortValue?.(repo, { ci: { status: 'ready', score: 100 } })).toBe(100);
    expect(ciColumn.getSortValue?.(repo, { ci: { status: 'ready', score: 0 } })).toBe(0);
  });

  it('sorts a missing CI slice to the bottom (score -1)', () => {
    expect(ciColumn.getSortValue?.(repo, {})).toBe(-1);
    expect(ciColumn.getSortValue?.(repo, { ci: { status: 'error' } })).toBe(-1);
  });

  it('renders a CiCell reflecting the slice state', () => {
    renderCell({ ci: { status: 'ready', conclusion: 'failure', score: 100, failingCount: 1 } });
    expect(screen.getByText('Failing')).toBeInTheDocument();
  });

  it('renders the unknown placeholder when no CI slice is present', () => {
    const { container } = renderCell({});
    expect(screen.getByText('—')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.sr-only')?.textContent ?? '').not.toBe('');
  });

  it('exports only the descriptor const (no local components)', async () => {
    const mod = await import('./CiColumn');
    expect(Object.keys(mod)).toEqual(['ciColumn']);
  });
});
