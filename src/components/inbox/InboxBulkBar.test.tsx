import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InboxBulkBar } from './InboxBulkBar';

function setup(overrides: Partial<Parameters<typeof InboxBulkBar>[0]> = {}) {
  const props = {
    count: 2,
    canMarkRead: true,
    canDismiss: true,
    canRestore: false,
    onMarkRead: vi.fn(),
    onDismiss: vi.fn(),
    onRestore: vi.fn(),
    onSelectAll: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
  render(<InboxBulkBar {...props} />);
  return props;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InboxBulkBar', () => {
  it('is a labelled toolbar region announcing the selection count', () => {
    setup({ count: 3 });

    const toolbar = screen.getByRole('toolbar', { name: /bulk actions/i });
    expect(toolbar).toHaveTextContent(/3 selected/i);
  });

  it('wires each action button to its handler', async () => {
    const user = userEvent.setup();
    const props = setup({ canRestore: true });

    await user.click(screen.getByRole('button', { name: /^mark read$/i }));
    expect(props.onMarkRead).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /^dismiss$/i }));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /^restore$/i }));
    expect(props.onRestore).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /select all/i }));
    expect(props.onSelectAll).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /clear selection/i }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it('disables Restore when no dismissed item is selected', () => {
    setup({ canRestore: false });
    expect(screen.getByRole('button', { name: /^restore$/i })).toBeDisabled();
  });

  it('disables Mark read and Dismiss when they are not applicable', () => {
    setup({ canMarkRead: false, canDismiss: false });
    expect(screen.getByRole('button', { name: /^mark read$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^dismiss$/i })).toBeDisabled();
  });
});
