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

  it('renders a distinct error glyph that is NOT the CI-failure × and keeps the signal label', () => {
    const { container } = render(
      <BoardKey
        repo={makeRepo()}
        signal="issues"
        data={{ issues: { status: 'error' } }}
        onActivate={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(root(container)).toHaveAttribute('data-state', 'error');
    expect(part(container, 'error-glyph')).not.toBeNull();
    // A load error must never reuse the red CI-failure × glyph or accent.
    expect(container.querySelector('svg[data-status="failure"]')).toBeNull();
    expect(container.querySelector('svg[data-status="action_required"]')).toBeInTheDocument();
    expect(part(container, 'accent-bar')?.style.backgroundColor).toBe('var(--color-warning)');
    // The signal label survives the error state (not overwritten by a retry hint).
    expect(part(container, 'line3')?.textContent).toBe('Open Issues');
  });

  it('shows the signal label and stays non-interactive for an error key with no handlers', () => {
    const { container } = render(
      <BoardKey repo={makeRepo()} signal="issues" data={{ issues: { status: 'error' } }} />,
    );

    expect(part(container, 'error-glyph')).not.toBeNull();
    expect(part(container, 'line3')?.textContent).toBe('Open Issues');
    expect(part(container, 'retry-hint')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders an explicit "n/a" placeholder for an empty value signal', () => {
    const { container } = render(<BoardKey repo={makeRepo()} signal="issues" data={{}} />);

    expect(root(container)).toHaveAttribute('data-state', 'empty');
    expect(part(container, 'empty')?.textContent).toBe('n/a');
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

describe('BoardKey — deep link', () => {
  it('renders a ready key as a new-tab link to its GitHub href', () => {
    render(
      <BoardKey
        repo={makeRepo()}
        signal="issues"
        data={{ issues: { status: 'ready', openCount: 3 } }}
        href="https://github.com/octo/hello-world/issues"
      />,
    );

    const link = screen.getByRole('link', { name: /issues.*octo\/hello-world/i });
    expect(link).toHaveAttribute('href', 'https://github.com/octo/hello-world/issues');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
    expect(link).toHaveAttribute('data-signal', 'issues');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('prefers the deep link over onActivate when both are supplied', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(
      <BoardKey
        repo={makeRepo()}
        signal="issues"
        data={{ issues: { status: 'ready', openCount: 3 } }}
        href="https://github.com/octo/hello-world/issues"
        onActivate={onActivate}
      />,
    );

    const link = screen.getByRole('link', { name: /issues.*octo\/hello-world/i });
    await user.click(link);
    // The link navigates to GitHub; the in-app drill-down is not invoked.
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('keeps a retryable error key a retry button even when href is supplied', () => {
    render(
      <BoardKey
        repo={makeRepo()}
        signal="issues"
        data={{ issues: { status: 'error' } }}
        href="https://github.com/octo/hello-world/issues"
        onRetry={vi.fn()}
      />,
    );

    // Retry takes precedence over navigation for a failed signal.
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('BoardKey — error retry', () => {
  it('turns an error key into a button when onRetry is supplied', () => {
    render(
      <BoardKey
        repo={makeRepo()}
        signal="issues"
        data={{ issues: { status: 'error' } }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('calls onRetry (not onActivate) when an error key is pressed', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onRetry = vi.fn();
    render(
      <BoardKey
        repo={makeRepo()}
        signal="issues"
        data={{ issues: { status: 'error' } }}
        onActivate={onActivate}
        onRetry={onRetry}
      />,
    );

    await user.click(screen.getByRole('button'));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('keeps drill-down (onActivate) for a non-error key even when onRetry is supplied', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onRetry = vi.fn();
    const repo = makeRepo();
    render(
      <BoardKey
        repo={repo}
        signal="issues"
        data={{ issues: { status: 'ready', openCount: 3 } }}
        onActivate={onActivate}
        onRetry={onRetry}
      />,
    );

    await user.click(screen.getByRole('button'));

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(repo);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('exposes a retry-specific accessible name carrying the signal + full nameWithOwner', () => {
    localStorage.setItem(REPO_OWNER_KEY, 'hide');
    render(
      <BoardKey
        repo={makeRepo()}
        signal="issues"
        data={{ issues: { status: 'error' } }}
        onRetry={vi.fn()}
      />,
    );

    const name = screen.getByRole('button').getAttribute('aria-label') ?? '';
    expect(name).toMatch(/retry/i);
    expect(name).toContain('Issues');
    expect(name).toContain('octo/hello-world');
  });

  it('shows a visible "Retry" affordance only while the error key is retryable', () => {
    const { container, rerender } = render(
      <BoardKey
        repo={makeRepo()}
        signal="issues"
        data={{ issues: { status: 'error' } }}
        onRetry={vi.fn()}
      />,
    );

    expect(part(container, 'retry-hint')?.textContent).toMatch(/retry/i);

    rerender(<BoardKey repo={makeRepo()} signal="issues" data={{ issues: { status: 'error' } }} />);
    expect(part(container, 'retry-hint')).toBeNull();
  });

  it('turns an errored key with onActivate-only into a drill-down button (#508)', async () => {
    // Errored BoardKey with onActivate but NO onRetry: the key becomes a button
    // that calls onActivate (drill-down-on-error), not a retry affordance.
    // Not reachable via BoardView (always threads onRetry), but valid for the
    // component contract.
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const repo = makeRepo();
    render(
      <BoardKey
        repo={repo}
        signal="issues"
        data={{ issues: { status: 'error' } }}
        onActivate={onActivate}
      />,
    );

    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
    expect(part(document.body, 'retry-hint')).toBeNull();

    await user.click(button);

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(repo);
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

describe('BoardKey — security no-access key accessible text', () => {
  const noAccessData: RepoSignalData = { security: { status: 'ready' } };
  const NO_ACCESS_REASON =
    'No security-alert access for this repository (token scope or feature disabled)';

  it('includes the no-access reason in the aria-label of an interactive no-access security key', () => {
    render(
      <BoardKey repo={makeRepo()} signal="security" data={noAccessData} onActivate={vi.fn()} />,
    );

    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-label')).toContain(NO_ACCESS_REASON);
  });

  it('includes the no-access reason in the sr-only text of a non-interactive no-access security key', () => {
    const { container } = render(
      <BoardKey repo={makeRepo()} signal="security" data={noAccessData} />,
    );

    expect(container.querySelector('.sr-only')?.textContent).toContain(NO_ACCESS_REASON);
  });

  it('adds a title attribute on the root element for hover context', () => {
    const { container } = render(
      <BoardKey repo={makeRepo()} signal="security" data={noAccessData} />,
    );

    expect(root(container).getAttribute('title')).toBe(NO_ACCESS_REASON);
  });

  it('adds a title attribute on the interactive (button) root element too', () => {
    const { container } = render(
      <BoardKey repo={makeRepo()} signal="security" data={noAccessData} onActivate={vi.fn()} />,
    );

    expect(root(container).getAttribute('title')).toBe(NO_ACCESS_REASON);
  });

  it('does NOT add the no-access reason to a graded security key with counts', () => {
    const gradedData: RepoSignalData = {
      security: {
        status: 'ready',
        grade: 'A',
        counts: { critical: 0, high: 0, medium: 0, low: 0 },
      },
    };
    render(<BoardKey repo={makeRepo()} signal="security" data={gradedData} onActivate={vi.fn()} />);

    const name = screen.getByRole('button').getAttribute('aria-label') ?? '';
    expect(name).not.toContain('token scope');
    expect(name).not.toContain('No security-alert access');
  });

  it('does NOT add the no-access reason to a security key in the error state', () => {
    render(
      <BoardKey
        repo={makeRepo()}
        signal="security"
        data={{ security: { status: 'error' } }}
        onActivate={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const name = screen.getByRole('button').getAttribute('aria-label') ?? '';
    expect(name).not.toContain('token scope');
    expect(name).not.toContain('No security-alert access');
  });

  it('does NOT set title on a non-security key', () => {
    const { container } = render(
      <BoardKey repo={makeRepo()} signal="issues" data={{ issues: { status: 'ready' } }} />,
    );

    expect(root(container).getAttribute('title')).toBeNull();
  });
});
