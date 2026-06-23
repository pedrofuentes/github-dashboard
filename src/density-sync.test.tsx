/**
 * Regression test for T-fix-density-sync: the Settings density toggle and the
 * FleetMatrix each call {@link useDensity} from their own component, so a shared
 * reactive store is the ONLY thing that lets a toggle click re-render the matrix
 * live. This renders the real {@link DensityToggle} and the real
 * {@link FleetMatrix} in one tree and asserts the user's exact symptom — picking
 * "Glanceable" tightens the matrix body-cell padding immediately.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DensityToggle } from './components/DensityToggle';
import { FleetMatrix } from './components/FleetMatrix';
import type { CommitActivityState } from './hooks/useCommitActivity';
import { useCommitActivity } from './hooks/useCommitActivity';
import type { GetRowData, Repo, RepoSignalData } from './types/fleet';

vi.mock('./hooks/useCommitActivity', () => ({ useCommitActivity: vi.fn() }));

const mockActivity = vi.mocked(useCommitActivity);

const OK_ACTIVITY: CommitActivityState = {
  state: 'ok',
  weeks: [
    { total: 3, week: 1700000000, days: [0, 1, 0, 1, 0, 1, 0] },
    { total: 5, week: 1700604800, days: [1, 1, 1, 0, 1, 1, 0] },
  ],
};

function repo(nameWithOwner: string): Repo {
  const slash = nameWithOwner.indexOf('/');
  return {
    nameWithOwner,
    owner: nameWithOwner.slice(0, slash),
    name: nameWithOwner.slice(slash + 1),
    isPrivate: false,
  };
}

/** A "broken" repo (failing CI) keeps the row out of the default-collapsed Healthy band. */
const BROKEN: RepoSignalData = { ci: { status: 'ready', conclusion: 'failure' } };
const getRowData: GetRowData = () => BROKEN;

beforeEach(() => {
  localStorage.clear();
  mockActivity.mockReturnValue(OK_ACTIVITY);
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('density propagation (T-fix-density-sync)', () => {
  it('flips FleetMatrix body-cell padding live when the DensityToggle switches to Glanceable', async () => {
    const user = userEvent.setup();
    render(
      <>
        <DensityToggle />
        <FleetMatrix repos={[repo('octo/hello')]} getRowData={getRowData} />
      </>,
    );

    const rowHeader = within(screen.getByRole('row', { name: /octo\/hello/i })).getByRole(
      'rowheader',
    );
    // Balanced (default) renders the looser py-2 spacing.
    expect(rowHeader.className).toMatch(/py-2(?:\s|$)/);

    await user.click(screen.getByRole('radio', { name: /glanceable/i }));

    // The shared store must re-render the matrix to the tighter py-1 spacing —
    // this is the user-reported symptom and fails on the per-instance impl.
    const updatedHeader = within(screen.getByRole('row', { name: /octo\/hello/i })).getByRole(
      'rowheader',
    );
    expect(updatedHeader.className).toMatch(/py-1(?:\s|$)/);
    expect(updatedHeader.className).not.toMatch(/py-2(?:\s|$)/);
  });
});
