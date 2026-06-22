import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
});
