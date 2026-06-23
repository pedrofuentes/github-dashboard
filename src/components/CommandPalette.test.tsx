import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette } from './CommandPalette';
import type { CommandItem } from './CommandPalette';

function makeCommands(run: Record<string, () => void> = {}): CommandItem[] {
  return [
    { id: 'alpha', label: 'Alpha Action', group: 'Navigation', run: run.alpha ?? vi.fn() },
    {
      id: 'bravo',
      label: 'Bravo Action',
      group: 'Navigation',
      keywords: ['second'],
      run: run.bravo ?? vi.fn(),
    },
    {
      id: 'charlie',
      label: 'Charlie Settings',
      group: 'Preferences',
      keywords: ['config'],
      run: run.charlie ?? vi.fn(),
    },
  ];
}

function Harness({ commands, recents }: { commands: CommandItem[]; recents?: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open palette
      </button>
      <CommandPalette
        open={open}
        onClose={() => setOpen(false)}
        commands={commands}
        recents={recents}
      />
    </>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CommandPalette accessibility', () => {
  it('renders nothing while closed', () => {
    render(<CommandPalette open={false} onClose={vi.fn()} commands={makeCommands()} />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a modal dialog with a combobox and a listbox when open', () => {
    render(<CommandPalette open onClose={vi.fn()} commands={makeCommands()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('combobox')).toBeInTheDocument();
    expect(within(dialog).getByRole('listbox')).toBeInTheDocument();
  });

  it('moves focus to the search input when it opens', async () => {
    const user = userEvent.setup();
    render(<Harness commands={makeCommands()} />);

    await user.click(screen.getByRole('button', { name: /open palette/i }));

    const input = screen.getByRole('combobox');
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('closes on Escape and returns focus to the triggering control', async () => {
    const user = userEvent.setup();
    render(<Harness commands={makeCommands()} />);
    const trigger = screen.getByRole('button', { name: /open palette/i });

    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CommandPalette open onClose={onClose} commands={makeCommands()} />);

    await user.click(screen.getByTestId('command-palette-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab focus within the dialog (focus trap)', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={vi.fn()} commands={makeCommands()} />);
    const dialog = screen.getByRole('dialog');

    for (let i = 0; i < 4; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('announces the result count via a polite live region', () => {
    render(<CommandPalette open onClose={vi.fn()} commands={makeCommands()} />);

    const live = screen.getByTestId('command-palette-live');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent(/3 commands/i);
  });
});

describe('CommandPalette filtering and ranking', () => {
  it('filters and ranks commands as the query is typed', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={vi.fn()} commands={makeCommands()} />);

    await user.type(screen.getByRole('combobox'), 'charlie');

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent(/charlie settings/i);
  });

  it('matches against keywords as well as the label', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={vi.fn()} commands={makeCommands()} />);

    await user.type(screen.getByRole('combobox'), 'config');

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent(/charlie settings/i);
  });

  it('shows an accessible empty state when nothing matches', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={vi.fn()} commands={makeCommands()} />);

    await user.type(screen.getByRole('combobox'), 'zzzzzz');

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(within(screen.getByRole('listbox')).getByText(/no commands/i)).toBeInTheDocument();
  });

  it('shows recent commands first (in order) for an empty query', () => {
    render(
      <CommandPalette
        open
        onClose={vi.fn()}
        commands={makeCommands()}
        recents={['charlie', 'alpha']}
      />,
    );

    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent(/charlie settings/i);
    expect(options[1]).toHaveTextContent(/alpha action/i);
    expect(options[2]).toHaveTextContent(/bravo action/i);
  });

  it('strips a leading ">" command-mode prefix and shows an indicator', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={vi.fn()} commands={makeCommands()} />);

    await user.type(screen.getByRole('combobox'), '>charlie');

    expect(screen.getByTestId('command-palette-mode')).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent(/charlie settings/i);
  });
});

describe('CommandPalette keyboard model', () => {
  it('tracks the active option with aria-activedescendant and runs it on Enter', async () => {
    const alpha = vi.fn();
    const bravo = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CommandPalette open onClose={onClose} commands={makeCommands({ alpha, bravo })} />);
    const input = screen.getByRole('combobox');

    // First option active by default.
    const options = screen.getAllByRole('option');
    await waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', options[0].id));

    await user.keyboard('{ArrowDown}');
    const afterDown = screen.getAllByRole('option');
    expect(input).toHaveAttribute('aria-activedescendant', afterDown[1].id);

    await user.keyboard('{Enter}');
    expect(bravo).toHaveBeenCalledTimes(1);
    expect(alpha).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('wraps from the first option to the last with ArrowUp', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={vi.fn()} commands={makeCommands()} />);
    const input = screen.getByRole('combobox');

    await user.keyboard('{ArrowUp}');

    const options = screen.getAllByRole('option');
    expect(input).toHaveAttribute('aria-activedescendant', options[options.length - 1].id);
  });

  it('jumps to the first and last option with Home and End', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={vi.fn()} commands={makeCommands()} />);
    const input = screen.getByRole('combobox');
    const options = screen.getAllByRole('option');

    await user.keyboard('{End}');
    expect(input).toHaveAttribute('aria-activedescendant', options[options.length - 1].id);

    await user.keyboard('{Home}');
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
  });

  it('runs a command and closes when its option is clicked', async () => {
    const charlie = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CommandPalette open onClose={onClose} commands={makeCommands({ charlie })} />);

    await user.click(screen.getByRole('option', { name: /charlie settings/i }));

    expect(charlie).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // #417: a throwing command must not strand the palette open — onClose() and
  // focus-restore still run via try/catch/finally around the command execution,
  // and the error is surfaced (console.error) instead of escaping React.
  it('still closes (and restores focus) when a command run throws on Enter', async () => {
    const onClose = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = vi.fn(() => {
      throw new Error('boom');
    });
    const user = userEvent.setup();
    function ThrowHarness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            open palette
          </button>
          <CommandPalette
            open={open}
            onClose={() => {
              onClose();
              setOpen(false);
            }}
            commands={[{ id: 'boom', label: 'Boom Action', group: 'Navigation', run: boom }]}
          />
        </>
      );
    }
    render(<ThrowHarness />);

    await screen.findByRole('combobox');
    await user.keyboard('{Enter}');

    expect(boom).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('still closes when a clicked command run throws', async () => {
    const onClose = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = vi.fn(() => {
      throw new Error('boom');
    });
    const user = userEvent.setup();
    render(
      <CommandPalette
        open
        onClose={onClose}
        commands={[{ id: 'boom', label: 'Boom Action', group: 'Navigation', run: boom }]}
      />,
    );

    await user.click(screen.getByRole('option', { name: /boom action/i }));

    expect(boom).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});

// #468 — WCAG 2.4.7 Focus Visible: the active descendant is the only visible
// keyboard-focus indicator, so moving the highlight past the scroll viewport
// must scroll it back into view. These tests assert the scroll *contract*
// (jsdom has no layout): scrollIntoView({ block: 'nearest' }) is called on the
// CORRECT (active) option element, and never when there is no active option.
describe('CommandPalette active-option visibility (WCAG 2.4.7)', () => {
  it('scrolls the newly active option into view on ArrowDown', async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<CommandPalette open onClose={vi.fn()} commands={makeCommands()} />);
    await screen.findByRole('combobox');
    scrollSpy.mockClear();

    await user.keyboard('{ArrowDown}');

    const active = screen.getAllByRole('option')[1];
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });
    expect(scrollSpy.mock.instances[scrollSpy.mock.instances.length - 1]).toBe(active);
  });

  it('scrolls the last option into view on End', async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<CommandPalette open onClose={vi.fn()} commands={makeCommands()} />);
    await screen.findByRole('combobox');
    scrollSpy.mockClear();

    await user.keyboard('{End}');

    const options = screen.getAllByRole('option');
    const last = options[options.length - 1];
    expect(last).toHaveAttribute('aria-selected', 'true');
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });
    expect(scrollSpy.mock.instances[scrollSpy.mock.instances.length - 1]).toBe(last);
  });

  it('does not scroll while the palette is closed', () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');

    render(<CommandPalette open={false} onClose={vi.fn()} commands={makeCommands()} />);

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('does not scroll when navigating with no matching options', async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={vi.fn()} commands={makeCommands()} />);
    const input = await screen.findByRole('combobox');
    await user.type(input, 'zzzzzz');
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');

    await user.keyboard('{ArrowDown}');

    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
