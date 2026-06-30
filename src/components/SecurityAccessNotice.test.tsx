import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SecurityAccessNotice } from './SecurityAccessNotice';

const STORAGE_KEY = 'gh-dashboard:security-access-dismissed';

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('SecurityAccessNotice', () => {
  it('renders nothing when show is false', () => {
    const { container } = render(<SecurityAccessNotice show={false} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders actionable scope guidance and a Learn more link when shown', () => {
    render(<SecurityAccessNotice show />);

    expect(screen.getByRole('status')).toHaveTextContent(/security grades are unavailable/i);
    expect(screen.getByRole('status')).toHaveTextContent(/token.*security-alert access/i);
    expect(screen.getByRole('status')).toHaveTextContent(/disabled/i);
    expect(screen.getByRole('status')).toHaveTextContent(/security_events/i);
    expect(screen.getByRole('status')).toHaveTextContent(/dependabot alerts: read/i);
    expect(screen.getByRole('status')).toHaveTextContent(/code scanning alerts: read/i);
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /learn more/i })).toHaveAttribute(
      'href',
      'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
    );
  });

  it('hides and persists the dismissal for the current session', async () => {
    const user = userEvent.setup();
    render(<SecurityAccessNotice show />);

    await user.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(screen.queryByRole('status')).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('warns and still dismisses when sessionStorage persistence fails', async () => {
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<SecurityAccessNotice show />);

    await user.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(screen.queryByRole('status')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      '[security-notice] failed to persist dismissal',
      expect.any(Error),
    );
  });

  it('stays hidden when already dismissed in sessionStorage', () => {
    sessionStorage.setItem(STORAGE_KEY, 'true');

    const { container } = render(<SecurityAccessNotice show />);

    expect(container).toBeEmptyDOMElement();
  });
});
