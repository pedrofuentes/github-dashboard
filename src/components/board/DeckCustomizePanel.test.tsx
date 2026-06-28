import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { DeckCustomizePanel } from './DeckCustomizePanel';
import { DECK_SIGNALS } from '../../lib/deck-visibility';
import type { TileSignalType } from '../../types/dashboard';
import type { Repo } from '../../types/fleet';

const repo = (nameWithOwner: string): Repo => {
  const [owner, name] = nameWithOwner.split('/');
  return { nameWithOwner, owner, name: name ?? nameWithOwner, isPrivate: false };
};

const repos = [repo('octo/a'), repo('octo/b')];

/** Builds a `repo:signal` hidden-set id, matching `deckKeyId`. */
const key = (r: string, s: TileSignalType): string => `${r}:${s}`;

function setup(overrides: Partial<React.ComponentProps<typeof DeckCustomizePanel>> = {}) {
  const onToggleKey = vi.fn();
  const onSetSignal = vi.fn();
  const onSetRepo = vi.fn();
  const onSetAll = vi.fn();
  const onShowOnly = vi.fn();
  const onReset = vi.fn();
  const onResetOrder = vi.fn();
  const onClose = vi.fn();
  const props = {
    repos,
    hidden: new Set<string>(),
    onToggleKey,
    onSetSignal,
    onSetRepo,
    onSetAll,
    onShowOnly,
    onReset,
    onResetOrder,
    onClose,
    ...overrides,
  };
  render(<DeckCustomizePanel {...props} />);
  return {
    ...props,
    onToggleKey,
    onSetSignal,
    onSetRepo,
    onSetAll,
    onShowOnly,
    onReset,
    onResetOrder,
    onClose,
  };
}

// Mirrors CustomizePanel.test.tsx's harness: an opener button that mounts the
// panel on click, so focus-on-open and return-focus-on-close (both of which
// depend on a real previously-focused element and an unmount) can be exercised.
function Harness(overrides: Partial<React.ComponentProps<typeof DeckCustomizePanel>> = {}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open deck customize
      </button>
      {open ? (
        <DeckCustomizePanel
          repos={repos}
          hidden={new Set()}
          onToggleKey={vi.fn()}
          onSetSignal={vi.fn()}
          onSetRepo={vi.fn()}
          onSetAll={vi.fn()}
          onShowOnly={vi.fn()}
          onReset={vi.fn()}
          onResetOrder={vi.fn()}
          onClose={() => setOpen(false)}
          {...overrides}
        />
      ) : null}
    </>
  );
}

describe('DeckCustomizePanel', () => {
  it('is a labelled modal dialog', () => {
    setup();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName();
  });

  it('renders one global toggle per Deck signal and one row per matching repo', async () => {
    setup();
    const rules = screen.getByRole('group', { name: /signal/i });
    const toggles = within(rules).getAllByRole('button', { name: /all .+ keys$/i });
    expect(toggles).toHaveLength(DECK_SIGNALS.length);

    await userEvent.type(screen.getByRole('textbox', { name: /search repositories/i }), 'octo/');
    const repoToggles = screen.getAllByRole('button', { name: /keys for /i });
    expect(repoToggles).toHaveLength(repos.length);
  });

  it('hides a signal across ALL repos when it is fully shown', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /hide all ci keys/i }));
    expect(props.onSetSignal).toHaveBeenCalledTimes(1);
    expect(props.onSetSignal).toHaveBeenCalledWith('ci', true);
  });

  it('shows a signal across ALL repos when it is fully hidden', async () => {
    const props = setup({ hidden: new Set([key('octo/a', 'ci'), key('octo/b', 'ci')]) });
    await userEvent.click(screen.getByRole('button', { name: /show all ci keys/i }));
    expect(props.onSetSignal).toHaveBeenCalledWith('ci', false);
  });

  it('reflects per-signal tri-state (all / some / none) from the hidden set', () => {
    setup({
      hidden: new Set([key('octo/a', 'ci'), key('octo/a', 'security'), key('octo/b', 'security')]),
    });
    const ci = document.querySelector('[data-signal="ci"] [data-state]');
    const security = document.querySelector('[data-signal="security"] [data-state]');
    const reviews = document.querySelector('[data-signal="reviews"] [data-state]');
    expect(ci).toHaveAttribute('data-state', 'some');
    expect(ci).toHaveTextContent('1 of 2 shown');
    expect(security).toHaveAttribute('data-state', 'none');
    expect(security).toHaveTextContent('0 of 2 shown');
    expect(reviews).toHaveAttribute('data-state', 'all');
    expect(reviews).toHaveTextContent('2 of 2 shown');
  });

  it('"Show all keys" reveals every key via onSetAll(false)', async () => {
    const props = setup({ hidden: new Set([key('octo/a', 'ci')]) });
    await userEvent.click(screen.getByRole('button', { name: /^show all keys$/i }));
    expect(props.onSetAll).toHaveBeenCalledWith(false);
  });

  it('"Hide all keys" hides every key via onSetAll(true)', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /^hide all keys$/i }));
    expect(props.onSetAll).toHaveBeenCalledWith(true);
  });

  it('enables "Show only selected" once a signal is chosen and calls onShowOnly', async () => {
    const props = setup();
    const showOnly = screen.getByRole('button', { name: /show only selected/i });
    expect(showOnly).toBeDisabled();

    const include = screen.getByRole('checkbox', { name: /include security in show-only/i });
    await userEvent.click(include);
    expect(showOnly).toBeEnabled();

    await userEvent.click(showOnly);
    const keep = props.onShowOnly.mock.calls[0][0] as Set<TileSignalType>;
    expect(keep.has('security')).toBe(true);
    expect(keep.has('ci')).toBe(false);

    // Deselecting re-disables the control (covers the de-select branch).
    await userEvent.click(include);
    expect(showOnly).toBeDisabled();
  });

  it('toggles a whole repo row via onSetRepo (hide when shown, show when hidden)', async () => {
    const allOfA = new Set(DECK_SIGNALS.map((signal) => key('octo/a', signal)));
    const props = setup({ hidden: allOfA });

    await userEvent.type(screen.getByRole('textbox', { name: /search repositories/i }), 'octo/');

    // octo/a is fully hidden → its row control shows it.
    await userEvent.click(screen.getByRole('button', { name: /show all keys for octo\/a/i }));
    expect(props.onSetRepo).toHaveBeenCalledWith('octo/a', false);

    // octo/b is fully shown → its row control hides it.
    await userEvent.click(screen.getByRole('button', { name: /hide all keys for octo\/b/i }));
    expect(props.onSetRepo).toHaveBeenCalledWith('octo/b', true);
  });

  it('toggles a single (repo, signal) key via onToggleKey and reflects checked state', async () => {
    const props = setup({ hidden: new Set([key('octo/a', 'ci')]) });

    await userEvent.type(screen.getByRole('textbox', { name: /search repositories/i }), 'octo/');

    const hiddenKey = screen.getByRole('checkbox', { name: /octo\/a, CI key, hidden/i });
    expect(hiddenKey).not.toBeChecked();
    await userEvent.click(hiddenKey);
    expect(props.onToggleKey).toHaveBeenCalledWith('octo/a', 'ci');

    const shownKey = screen.getByRole('checkbox', { name: /octo\/b, CI key, shown/i });
    expect(shownKey).toBeChecked();
  });

  it('renders no per-repo rows until a search query is entered', async () => {
    setup();
    expect(screen.queryByRole('button', { name: /keys for octo\/a/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /keys for octo\/b/i })).toBeNull();

    await userEvent.type(screen.getByRole('textbox', { name: /search repositories/i }), 'octo/a');
    expect(screen.getByRole('button', { name: /keys for octo\/a/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /keys for octo\/b/i })).toBeNull();
  });

  it('invokes onReset when the reset button is clicked', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /reset to default/i }));
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('invokes onResetOrder when the Reset order button is clicked', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /reset order/i }));
    expect(props.onResetOrder).toHaveBeenCalledTimes(1);
  });

  it('invokes onClose from the close control', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /close customize panel/i }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const props = setup();
    await userEvent.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalled();
  });

  it('closes when the backdrop is clicked', async () => {
    const props = setup();
    await userEvent.click(screen.getByTestId('deck-customize-backdrop'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus onto the close control when it opens', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /open deck customize/i }));

    const closeButton = screen.getByRole('button', { name: /close customize panel/i });
    await waitFor(() => expect(closeButton).toHaveFocus());
    expect(screen.getByRole('dialog')).toContainElement(closeButton);
  });

  it('returns focus to the triggering control when it closes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: /open deck customize/i });

    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('traps Tab focus within the dialog (wraps at both ends)', async () => {
    const user = userEvent.setup();
    setup();
    const close = screen.getByRole('button', { name: /close customize panel/i });
    const reset = screen.getByRole('button', { name: /reset to default/i });

    // Tab from the last focusable wraps to the first.
    reset.focus();
    await user.tab();
    expect(close).toHaveFocus();

    // Shift+Tab from the first focusable wraps to the last.
    await user.tab({ shift: true });
    expect(reset).toHaveFocus();
  });
});
