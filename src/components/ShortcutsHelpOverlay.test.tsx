import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShortcutsHelpOverlay } from './ShortcutsHelpOverlay';

function Harness(): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open help
      </button>
      {open ? <ShortcutsHelpOverlay onClose={() => setOpen(false)} /> : null}
    </>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ShortcutsHelpOverlay', () => {
  it('renders as a labelled modal dialog', () => {
    render(<ShortcutsHelpOverlay onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName(/keyboard shortcuts/i);
  });

  it('lists the navigation sequences and the ⌘K command-palette doc entry', () => {
    render(<ShortcutsHelpOverlay onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/go to triage/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/go to inbox/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/show keyboard shortcuts/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/open command palette/i)).toBeInTheDocument();
  });

  it('groups shortcuts under Navigation and General headings', () => {
    render(<ShortcutsHelpOverlay onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /navigation/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: /general/i })).toBeInTheDocument();
  });

  it('points users to ⌘K and Saved Views for presets', () => {
    render(<ShortcutsHelpOverlay onClose={vi.fn()} />);

    expect(screen.getByText(/saved views/i)).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ShortcutsHelpOverlay onClose={onClose} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ShortcutsHelpOverlay onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /close/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ShortcutsHelpOverlay onClose={onClose} />);

    await user.click(screen.getByTestId('shortcuts-help-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the dialog on open and restores it on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const opener = screen.getByRole('button', { name: /open help/i });
    await user.click(opener);

    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });

  it('traps Tab focus within the dialog', async () => {
    const user = userEvent.setup();
    render(<ShortcutsHelpOverlay onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });
});
