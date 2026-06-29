import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { CustomizePanel } from './CustomizePanel';
import { MAX_TILES } from '../lib/dashboard-layout';
import type { DashboardTile, TileSignalType } from '../types/dashboard';

const SIGNALS: TileSignalType[] = [
  'ci',
  'security',
  'reviews',
  'pullRequests',
  'issues',
  'stale',
  'activity',
];

const tile = (repo: string, signal: DashboardTile['signal'], visible = true): DashboardTile => ({
  i: `${repo}:${signal}`,
  signal,
  repo,
  x: 0,
  y: 0,
  w: 3,
  h: 2,
  visible,
});
const layout = [tile('octo/a', 'ci'), tile('octo/a', 'security'), tile('octo/b', 'ci')];

// A full two-repo board exercising all seven signals — used to assert the
// rule list renders one toggle per signal.
const fullLayout: DashboardTile[] = ['octo/a', 'octo/b'].flatMap((repo) =>
  SIGNALS.map((signal) => tile(repo, signal)),
);

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

  it('renders one signal rule toggle per distinct signal present in the layout', () => {
    setup({ layout: fullLayout });
    const rules = screen.getByRole('group', { name: /signal rules/i });
    // Seven signals → seven "show/hide all … tiles" toggles, one per signal.
    const toggles = within(rules).getAllByRole('button', { name: /all .* tiles$/i });
    expect(toggles).toHaveLength(SIGNALS.length);
  });

  it('hides a signal across ALL repos via setSignalVisibility', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /hide all ci tiles/i }));
    expect(props.onLayoutChange).toHaveBeenCalledTimes(1);
    const next = props.onLayoutChange.mock.calls[0][0] as DashboardTile[];
    expect(next.filter((t) => t.signal === 'ci').every((t) => !t.visible)).toBe(true);
    // security tiles untouched (signal-scoped, but across all repos)
    expect(next.find((t) => t.i === 'octo/a:security')?.visible).toBe(true);
  });

  it('shows a fully-hidden signal across ALL repos (tri-state aware label)', async () => {
    const hidden = [
      tile('octo/a', 'ci', false),
      tile('octo/b', 'ci', false),
      tile('octo/a', 'security', true),
    ];
    const props = setup({ layout: hidden });
    await userEvent.click(screen.getByRole('button', { name: /show all ci tiles/i }));
    const next = props.onLayoutChange.mock.calls[0][0] as DashboardTile[];
    expect(next.filter((t) => t.signal === 'ci').every((t) => t.visible)).toBe(true);
  });

  it('reports per-signal tri-state status (shown of total)', () => {
    setup({
      layout: [tile('octo/a', 'ci', true), tile('octo/b', 'ci', false)],
    });
    expect(screen.getByText(/1 of 2 shown/i)).toBeInTheDocument();
  });

  it('"Show all tiles" reveals every tile (setAllVisibility true)', async () => {
    const hidden = layout.map((t) => ({ ...t, visible: false }));
    const props = setup({ layout: hidden });
    await userEvent.click(screen.getByRole('button', { name: /^show all tiles$/i }));
    const next = props.onLayoutChange.mock.calls[0][0] as DashboardTile[];
    expect(next.every((t) => t.visible)).toBe(true);
  });

  it('"Hide all tiles" hides every tile (setAllVisibility false)', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /^hide all tiles$/i }));
    const next = props.onLayoutChange.mock.calls[0][0] as DashboardTile[];
    expect(next.every((t) => !t.visible)).toBe(true);
  });

  it('"Show only selected" keeps the chosen signals and hides the rest', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('checkbox', { name: /include security in show-only/i }));
    await userEvent.click(screen.getByRole('button', { name: /show only selected/i }));
    const next = props.onLayoutChange.mock.calls.at(-1)?.[0] as DashboardTile[];
    expect(next.filter((t) => t.signal === 'security').every((t) => t.visible)).toBe(true);
    expect(next.filter((t) => t.signal === 'ci').every((t) => !t.visible)).toBe(true);
  });

  it('allows a targeted per-repo signal override after searching for the repo', async () => {
    const props = setup();
    await userEvent.type(screen.getByRole('textbox', { name: /search repositories/i }), 'octo/a');
    await userEvent.click(screen.getByRole('checkbox', { name: /octo\/a.*CI tile/i }));
    const next = props.onLayoutChange.mock.calls.at(-1)?.[0] as DashboardTile[];
    expect(next.find((t) => t.i === 'octo/a:ci')?.visible).toBe(false);
    // other repos untouched by the per-repo override
    expect(next.find((t) => t.i === 'octo/b:ci')?.visible).toBe(true);
  });

  it('sets an alias through onSetAlias (per-repo override surfaced by search)', async () => {
    const props = setup();
    await userEvent.type(screen.getByRole('textbox', { name: /search repositories/i }), 'octo/a');
    const input = screen.getByRole('textbox', { name: /alias for octo\/a/i });
    await userEvent.type(input, 'Alpha');
    await userEvent.tab(); // commit on blur
    expect(props.onSetAlias).toHaveBeenCalledWith('octo/a', 'Alpha');
  });

  it('clears the alias when a whitespace-only value is committed on blur', async () => {
    const props = setup();
    await userEvent.type(screen.getByRole('textbox', { name: /search repositories/i }), 'octo/a');
    const input = screen.getByRole('textbox', { name: /alias for octo\/a/i });
    await userEvent.type(input, '   ');
    await userEvent.tab(); // commit on blur
    expect(props.onClearAlias).toHaveBeenCalledWith('octo/a');
    expect(props.onSetAlias).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const props = setup();
    await userEvent.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalled();
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

  it('closes when the backdrop is clicked', async () => {
    const props = setup();
    await userEvent.click(screen.getByTestId('customize-backdrop'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('invokes onReset when the reset button is clicked', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /reset to default layout/i }));
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('shows the tile-limit status region when the layout is at capacity (MAX_TILES)', () => {
    const atCapacity = Array.from({ length: MAX_TILES }, (_, index) => ({
      ...tile('octo/big', 'ci'),
      i: `octo/big:ci:${index}`,
    }));
    setup({ layout: atCapacity });
    expect(screen.getByRole('status')).toHaveTextContent(
      new RegExp(`tile limit reached \\(${MAX_TILES}\\)`, 'i'),
    );
  });

  it('leaves the tile-limit status region empty below capacity', () => {
    setup(); // default 3-tile layout is far below MAX_TILES
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
