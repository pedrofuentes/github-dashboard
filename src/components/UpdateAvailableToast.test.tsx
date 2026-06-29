import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UpdateAvailableToast } from './UpdateAvailableToast';

const DISMISSED_KEY = 'gh-dashboard:update-dismissed';

describe('UpdateAvailableToast', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('renders nothing when no update is available', () => {
    const { container } = render(
      <UpdateAvailableToast updateAvailable={false} deployedSha="def5678" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows update text with reload and dismiss actions when available', () => {
    render(<UpdateAvailableToast updateAvailable deployedSha="def5678" />);

    expect(screen.getByRole('status')).toHaveTextContent('A new version is available.');
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('calls the reload callback', async () => {
    const onReload = vi.fn();
    const user = userEvent.setup();
    render(<UpdateAvailableToast updateAvailable deployedSha="def5678" onReload={onReload} />);

    await user.click(screen.getByRole('button', { name: /reload/i }));

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('hides after dismissal and persists the dismissed SHA', async () => {
    const user = userEvent.setup();
    render(<UpdateAvailableToast updateAvailable deployedSha="def5678" />);

    await user.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(sessionStorage.getItem(DISMISSED_KEY)).toBe('def5678');
  });

  it('keeps a previously dismissed SHA hidden but shows a newer SHA', () => {
    sessionStorage.setItem(DISMISSED_KEY, 'def5678');

    const { rerender } = render(<UpdateAvailableToast updateAvailable deployedSha="def5678" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    rerender(<UpdateAvailableToast updateAvailable deployedSha="fed4321" />);

    expect(screen.getByRole('status')).toHaveTextContent('A new version is available.');
  });
});
