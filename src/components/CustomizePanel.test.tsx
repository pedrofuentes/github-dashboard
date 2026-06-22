import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { CustomizePanel } from './CustomizePanel';
import type { DashboardTile } from '../types/dashboard';

const tile = (repo: string, signal: DashboardTile['signal']): DashboardTile => ({
  i: `${repo}:${signal}`,
  signal,
  repo,
  x: 0,
  y: 0,
  w: 3,
  h: 2,
  visible: true,
});
const layout = [tile('octo/a', 'ci'), tile('octo/a', 'security'), tile('octo/b', 'ci')];

function setup(overrides: Partial<React.ComponentProps<typeof CustomizePanel>> = {}) {
  const onLayoutChange = vi.fn();
  const onSetAlias = vi.fn();
  const onClearAlias = vi.fn();
  const onReset = vi.fn();
  const onClose = vi.fn();
  const props = {
    layout,
    onLayoutChange,
    aliases: {} as Record<string, string>,
    onSetAlias,
    onClearAlias,
    onReset,
    onClose,
    ...overrides,
  };
  render(<CustomizePanel {...props} />);
  return { ...props, onLayoutChange, onSetAlias, onClearAlias, onReset, onClose };
}

// Mirrors DrillDownDrawer.test.tsx's harness: an opener button that mounts the
// panel on click, so focus-on-open and return-focus-on-close (which both depend
// on a real previously-focused element and an unmount) can be exercised.
function Harness(overrides: Partial<React.ComponentProps<typeof CustomizePanel>> = {}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open customize
      </button>
      {open ? (
        <CustomizePanel
          layout={layout}
          onLayoutChange={vi.fn()}
          aliases={{}}
          onSetAlias={vi.fn()}
          onClearAlias={vi.fn()}
          onReset={vi.fn()}
          onClose={() => setOpen(false)}
          {...overrides}
        />
      ) : null}
    </>
  );
}

describe('CustomizePanel', () => {
  it('is a labelled modal dialog', () => {
    setup();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName();
  });

  it('hides a tile by flipping visible through onLayoutChange', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('checkbox', { name: /octo\/a.*CI/i }));
    expect(props.onLayoutChange).toHaveBeenCalledTimes(1);
    const next = props.onLayoutChange.mock.calls[0][0] as DashboardTile[];
    expect(next.find((t) => t.i === 'octo/a:ci')?.visible).toBe(false);
  });

  it('group toggle flips every tile of the repo', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /hide all octo\/a/i }));
    const next = props.onLayoutChange.mock.calls[0][0] as DashboardTile[];
    expect(next.filter((t) => t.repo === 'octo/a').every((t) => !t.visible)).toBe(true);
  });

  it('sets an alias through onSetAlias', async () => {
    const props = setup();
    const input = screen.getByRole('textbox', { name: /alias for octo\/a/i });
    await userEvent.type(input, 'Alpha');
    await userEvent.tab(); // commit on blur
    expect(props.onSetAlias).toHaveBeenCalledWith('octo/a', 'Alpha');
  });

  it('closes on Escape', async () => {
    const props = setup();
    await userEvent.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalled();
  });

  it('clears the alias when a whitespace-only value is committed on blur', async () => {
    const props = setup();
    const input = screen.getByRole('textbox', { name: /alias for octo\/a/i });
    await userEvent.type(input, '   ');
    await userEvent.tab(); // commit on blur
    expect(props.onClearAlias).toHaveBeenCalledWith('octo/a');
    expect(props.onSetAlias).not.toHaveBeenCalled();
  });

  it('group toggle re-shows every tile when the repo is fully hidden', async () => {
    const hidden = [
      { ...tile('octo/a', 'ci'), visible: false },
      { ...tile('octo/a', 'security'), visible: false },
      tile('octo/b', 'ci'),
    ];
    const props = setup({ layout: hidden });
    await userEvent.click(screen.getByRole('button', { name: /show all octo\/a/i }));
    expect(props.onLayoutChange).toHaveBeenCalledTimes(1);
    const next = props.onLayoutChange.mock.calls[0][0] as DashboardTile[];
    expect(next.filter((t) => t.repo === 'octo/a').every((t) => t.visible)).toBe(true);
  });

  it('moves focus into the dialog (onto the close control) when it opens', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /open customize/i }));

    const closeButton = screen.getByRole('button', { name: /close customize panel/i });
    await waitFor(() => expect(closeButton).toHaveFocus());
    expect(screen.getByRole('dialog')).toContainElement(closeButton);
  });

  it('returns focus to the triggering control when it closes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: /open customize/i });

    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
  });
});
