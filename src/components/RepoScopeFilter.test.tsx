import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepoScopeFilter } from './RepoScopeFilter';
import type { Repo } from '../types/fleet';

const repo = (n: string): Repo => ({ nameWithOwner: n, isPrivate: false }) as Repo;
const repos = [repo('octo/a'), repo('octo/b')];

it('toggles a repo selection', async () => {
  const onToggleRepo = vi.fn();
  render(
    <RepoScopeFilter
      repos={repos}
      selected={new Set()}
      onToggleRepo={onToggleRepo}
      onClear={() => {}}
      isActive={false}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: /filter repositories/i }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'octo/a' }));
  expect(onToggleRepo).toHaveBeenCalledWith('octo/a');
});

it('shows an active scope chip with a clear button', async () => {
  const onClear = vi.fn();
  render(
    <RepoScopeFilter
      repos={repos}
      selected={new Set(['octo/a'])}
      onToggleRepo={() => {}}
      onClear={onClear}
      isActive
    />,
  );
  expect(screen.getByText(/octo\/a/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /clear filter/i }));
  expect(onClear).toHaveBeenCalled();
});
