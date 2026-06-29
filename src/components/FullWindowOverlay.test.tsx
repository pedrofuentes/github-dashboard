import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FullWindowOverlay } from './FullWindowOverlay';

describe('FullWindowOverlay', () => {
  it('renders a labelled full-window region with the view label and its children', () => {
    render(
      <FullWindowOverlay label="Deck" onExit={vi.fn()}>
        <p>deck content</p>
      </FullWindowOverlay>,
    );

    const region = screen.getByRole('region', { name: /deck.*full window/i });
    expect(region).toBeInTheDocument();
    expect(screen.getByText('deck content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /exit full window/i })).toBeInTheDocument();
  });

  it('calls onExit when the Exit button is pressed', async () => {
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(
      <FullWindowOverlay label="Matrix" onExit={onExit}>
        <p>body</p>
      </FullWindowOverlay>,
    );

    await user.click(screen.getByRole('button', { name: /exit full window/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('calls onExit when Escape is pressed', async () => {
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(
      <FullWindowOverlay label="Matrix" onExit={onExit}>
        <p>body</p>
      </FullWindowOverlay>,
    );

    await user.keyboard('{Escape}');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the Exit button on open', () => {
    render(
      <FullWindowOverlay label="Deck" onExit={vi.fn()}>
        <p>body</p>
      </FullWindowOverlay>,
    );

    expect(screen.getByRole('button', { name: /exit full window/i })).toHaveFocus();
  });

  it('renders optional bar controls (e.g. the deck size control)', () => {
    render(
      <FullWindowOverlay label="Deck" onExit={vi.fn()} controls={<button>resize</button>}>
        <p>body</p>
      </FullWindowOverlay>,
    );

    expect(screen.getByRole('button', { name: 'resize' })).toBeInTheDocument();
  });

  it('restores focus to the previously focused element on close', async () => {
    const user = userEvent.setup();
    function Harness() {
      return (
        <FullWindowOverlay label="Deck" onExit={vi.fn()}>
          <p>body</p>
        </FullWindowOverlay>
      );
    }
    const opener = document.createElement('button');
    opener.textContent = 'opener';
    document.body.appendChild(opener);
    opener.focus();
    expect(opener).toHaveFocus();

    const { unmount } = render(<Harness />);
    // Focus moved into the overlay on open.
    expect(screen.getByRole('button', { name: /exit full window/i })).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
    void user;
  });
});
