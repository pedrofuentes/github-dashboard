import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetRepoOwnerStoreForTests } from '../../hooks/useRepoOwner';
import type { Repo, RepoSignalData } from '../../types/fleet';
import { BoardKey } from './BoardKey';

const REPO_OWNER_KEY = 'fleet:repo-owner';

function makeRepo(nameWithOwner = 'octo/hello-world'): Repo {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name, isPrivate: false };
}

function root(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-signal]');
  if (el === null) {
    throw new Error('BoardKey root ([data-signal]) not found');
  }
  return el;
}

function part(container: HTMLElement, name: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-part="${name}"]`);
}

// The reset seam drops leaked store subscribers; clearing localStorage resets
// the actual owner display (the store's source of truth) between tests.
beforeEach(() => {
  localStorage.clear();
  __resetRepoOwnerStoreForTests();
});

afterEach(() => {
  localStorage.clear();
});

describe('BoardKey — value layout', () => {
  it('renders the hero value, caption, and accent bar for a ready value signal', () => {
    const data: RepoSignalData = { issues: { status: 'ready', openCount: 12 } };
    const { container } = render(<BoardKey repo={makeRepo()} signal="issues" data={data} />);

    expect(part(container, 'value')?.textContent).toBe('12');
    expect(part(container, 'line3')?.textContent).toBe('Open Issues');

    const bar = part(container, 'accent-bar');
    expect(bar).not.toBeNull();
    expect(bar?.style.backgroundColor).toBe('var(--color-success)');
  });

  it('compacts large values via formatCount', () => {
    const data: RepoSignalData = { pullRequests: { status: 'ready', openCount: 1500 } };
    const { container } = render(<BoardKey repo={makeRepo()} signal="pullRequests" data={data} />);

    expect(part(container, 'value')?.textContent).toBe('1.5k');
  });

  it('renders the activity hero value + accent from the activity input', () => {
    const { container } = render(
      <BoardKey
        repo={makeRepo()}
        signal="activity"
        data={{}}
        activity={{ status: 'ready', commitsThisWeek: 42 }}
      />,
    );

    expect(part(container, 'value')?.textContent).toBe('42');
    expect(part(container, 'line3')?.textContent).toBe('Commits (7d)');
    expect(part(container, 'accent-bar')?.style.backgroundColor).toBe('var(--color-coral)');
  });
});

describe('BoardKey — icon layout', () => {
  it('renders BoardStatusIcon with the spec status for a ready CI signal', () => {
    const data: RepoSignalData = { ci: { status: 'ready', conclusion: 'success' } };
    const { container } = render(<BoardKey repo={makeRepo()} signal="ci" data={data} />);

    expect(root(container)).toHaveAttribute('data-layout', 'icon');
    expect(part(container, 'icon')).not.toBeNull();
    expect(container.querySelector('svg[data-status="success"]')).toBeInTheDocument();
    expect(part(container, 'line3')?.textContent).toBe('Success');
    expect(part(container, 'accent-bar')?.style.backgroundColor).toBe('var(--color-success)');
  });

  it('maps a failing CI conclusion to the failure icon + accent', () => {
    const data: RepoSignalData = { ci: { status: 'ready', conclusion: 'failure' } };
    const { container } = render(<BoardKey repo={makeRepo()} signal="ci" data={data} />);

    expect(container.querySelector('svg[data-status="failure"]')).toBeInTheDocument();
    expect(part(container, 'line3')?.textContent).toBe('Failed');
    expect(part(container, 'accent-bar')?.style.backgroundColor).toBe('var(--color-failure)');
  });

  it('colors the icon with the accent token (theme-aware, no raw hex)', () => {
    const data: RepoSignalData = { ci: { status: 'ready', conclusion: 'success' } };
    const { container } = render(<BoardKey repo={makeRepo()} signal="ci" data={data} />);

    expect(part(container, 'icon')?.style.color).toBe('var(--color-success)');
  });
});

describe('BoardKey — repo label honors the owner setting', () => {
  it('shows the full owner/name label by default', () => {
    const { container } = render(
      <BoardKey repo={makeRepo()} signal="issues" data={{ issues: { status: 'ready' } }} />,
    );

    expect(part(container, 'line1')?.textContent).toBe('octo/hello-world');
  });

  it('renders the bare repo name when the owner is hidden', () => {
    localStorage.setItem(REPO_OWNER_KEY, 'hide');
    const { container } = render(
      <BoardKey repo={makeRepo()} signal="issues" data={{ issues: { status: 'ready' } }} />,
    );

    expect(part(container, 'line1')?.textContent).toBe('hello-world');
  });

  it('keeps the FULL nameWithOwner + signal + value in the accessible name even when hidden', () => {
    localStorage.setItem(REPO_OWNER_KEY, 'hide');
    render(
      <BoardKey
        repo={makeRepo()}
        signal="issues"
        data={{ issues: { status: 'ready', openCount: 12 } }}
        onActivate={vi.fn()}
      />,
    );

    const button = screen.getByRole('button');
    const name = button.getAttribute('aria-label') ?? '';
    expect(name).toContain('octo/hello-world');
    expect(name).toContain('Issues');
    expect(name).toContain('12');
  });

  it('exposes the full nameWithOwner via an sr-only summary for non-interactive keys', () => {
    localStorage.setItem(REPO_OWNER_KEY, 'hide');
    const { container } = render(
      <BoardKey
        repo={makeRepo()}
        signal="ci"
        data={{ ci: { status: 'ready', conclusion: 'success' } }}
      />,
    );

    expect(container.querySelector('.sr-only')?.textContent).toContain('octo/hello-world');
    expect(container.querySelector('.sr-only')?.textContent).toContain('Success');
  });
});

describe('BoardKey — lifecycle states', () => {
  it('renders a reduced-motion-safe spinner while loading', () => {
    const { container } = render(
      <BoardKey repo={makeRepo()} signal="issues" data={{ issues: { status: 'loading' } }} />,
    );

    expect(root(container)).toHaveAttribute('data-state', 'loading');
    const spinner = part(container, 'spinner');
    expect(spinner).not.toBeNull();
    expect(spinner?.className).toContain('animate-spin');
    expect(spinner?.className).toContain('motion-reduce:animate-none');
    expect(part(container, 'value')).toBeNull();
    expect(part(container, 'accent-bar')?.style.backgroundColor).toBe('var(--color-neutral)');
  });

  it('renders an error glyph + retry caption wired to onActivate', () => {
    const onActivate = vi.fn();
    const { container } = render(
      <BoardKey
        repo={makeRepo()}
        signal="issues"
        data={{ issues: { status: 'error' } }}
        onActivate={onActivate}
      />,
    );

    expect(root(container)).toHaveAttribute('data-state', 'error');
    expect(part(container, 'error-glyph')).not.toBeNull();
    expect(container.querySelector('svg[data-status="failure"]')).toBeInTheDocument();
    expect(part(container, 'line3')?.textContent).toMatch(/retry/i);
    expect(part(container, 'accent-bar')?.style.backgroundColor).toBe('var(--color-failure)');
  });

  it('falls back to a static caption for an error key without onActivate', () => {
    const { container } = render(
      <BoardKey repo={makeRepo()} signal="issues" data={{ issues: { status: 'error' } }} />,
    );

    expect(part(container, 'error-glyph')).not.toBeNull();
    expect(part(container, 'line3')?.textContent).toBe('Open Issues');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a neutral dash placeholder for an empty value signal', () => {
    const { container } = render(<BoardKey repo={makeRepo()} signal="issues" data={{}} />);

    expect(root(container)).toHaveAttribute('data-state', 'empty');
    expect(part(container, 'empty')?.textContent).toBe('—');
    expect(part(container, 'value')).toBeNull();
    expect(part(container, 'accent-bar')?.style.backgroundColor).toBe('var(--color-neutral)');
  });

  it('renders the empty placeholder + "No Runs" caption for a CI key with no data', () => {
    const { container } = render(<BoardKey repo={makeRepo()} signal="ci" data={{}} />);

    expect(root(container)).toHaveAttribute('data-state', 'empty');
    expect(part(container, 'empty')).not.toBeNull();
    expect(part(container, 'line3')?.textContent).toBe('No Runs');
  });
});

describe('BoardKey — interactivity', () => {
  it('renders a button and fires onActivate with the repo on click', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const repo = makeRepo();
    render(
      <BoardKey
        repo={repo}
        signal="issues"
        data={{ issues: { status: 'ready', openCount: 3 } }}
        onActivate={onActivate}
      />,
    );

    await user.click(screen.getByRole('button'));

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(repo);
  });

  it('fires onActivate when the focused key is activated with Enter', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(
      <BoardKey
        repo={makeRepo()}
        signal="issues"
        data={{ issues: { status: 'ready', openCount: 3 } }}
        onActivate={onActivate}
      />,
    );

    const button = screen.getByRole('button');
    button.focus();
    await user.keyboard('{Enter}');

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('carries focus-visible ring utilities on the interactive key', () => {
    const { container } = render(
      <BoardKey
        repo={makeRepo()}
        signal="issues"
        data={{ issues: { status: 'ready' } }}
        onActivate={vi.fn()}
      />,
    );

    expect(root(container).className).toContain('focus-visible:outline-focus');
  });

  it('renders a non-interactive container when onActivate is omitted', () => {
    const { container } = render(
      <BoardKey repo={makeRepo()} signal="issues" data={{ issues: { status: 'ready' } }} />,
    );

    expect(screen.queryByRole('button')).toBeNull();
    expect(root(container).tagName).toBe('DIV');
  });
});

describe('BoardKey — data-* seams', () => {
  it('exposes data-signal, data-layout, and data-state on the root', () => {
    const { container } = render(
      <BoardKey
        repo={makeRepo()}
        signal="ci"
        data={{ ci: { status: 'ready', conclusion: 'success' } }}
      />,
    );

    const el = root(container);
    expect(el).toHaveAttribute('data-signal', 'ci');
    expect(el).toHaveAttribute('data-layout', 'icon');
    expect(el).toHaveAttribute('data-state', 'ready');
  });
});
