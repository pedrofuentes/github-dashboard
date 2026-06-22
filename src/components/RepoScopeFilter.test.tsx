import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepoScopeFilter } from './RepoScopeFilter';
import type { Repo } from '../types/fleet';

const repo = (n: string): Repo => ({ nameWithOwner: n, isPrivate: false }) as Repo;
const repos = [repo('octo/a'), repo('octo/b')];

it('does not advertise a listbox popup (it is a checkbox-group disclosure)', () => {
  render(
    <RepoScopeFilter
      repos={repos}
      selected={new Set()}
      onToggleRepo={() => {}}
      onClear={() => {}}
      isActive={false}
    />,
  );
  const button = screen.getByRole('button', { name: /filter repositories/i });
  expect(button).not.toHaveAttribute('aria-haspopup');
  expect(button).toHaveAttribute('aria-expanded');
  expect(button).toHaveAttribute('aria-controls');
});

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

it('announces the selection count in the polite live region', async () => {
  render(
    <RepoScopeFilter
      repos={repos}
      selected={new Set(['octo/a'])}
      onToggleRepo={() => {}}
      onClear={() => {}}
      isActive
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: /filter repositories/i }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'octo/b' }));
  const liveRegion = screen.getByText('Filtered to 2 repositories');
  expect(liveRegion).toHaveAttribute('aria-live', 'polite');
});

it('announces "Filter cleared" in the polite live region on clear', async () => {
  render(
    <RepoScopeFilter
      repos={repos}
      selected={new Set(['octo/a'])}
      onToggleRepo={() => {}}
      onClear={() => {}}
      isActive
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: /clear filter/i }));
  const liveRegion = screen.getByText('Filter cleared');
  expect(liveRegion).toHaveAttribute('aria-live', 'polite');
});

it('renders a (+N) overflow chip when more than one repo is selected', () => {
  const many = [repo('octo/a'), repo('octo/b'), repo('octo/c')];
  render(
    <RepoScopeFilter
      repos={many}
      selected={new Set(['octo/a', 'octo/b', 'octo/c'])}
      onToggleRepo={() => {}}
      onClear={() => {}}
      isActive
    />,
  );
  expect(screen.getByText(/octo\/a \(\+2\)/)).toBeInTheDocument();
});
