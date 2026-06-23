import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useKeyboardShortcuts } from './useKeyboardShortcuts';
import type { FleetView } from '../lib/view-preference';

interface HandlerSpies {
  navigate: ReturnType<typeof vi.fn>;
  openHelp: ReturnType<typeof vi.fn>;
  openSettings: ReturnType<typeof vi.fn>;
}

function Harness({ handlers }: { handlers: HandlerSpies }): null {
  useKeyboardShortcuts({
    navigate: handlers.navigate as (view: FleetView) => void,
    openHelp: handlers.openHelp,
    openSettings: handlers.openSettings,
  });
  return null;
}

function makeSpies(): HandlerSpies {
  return { navigate: vi.fn(), openHelp: vi.fn(), openSettings: vi.fn() };
}

function press(key: string, init: KeyboardEventInit = {}, target?: EventTarget): void {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  if (target !== undefined) {
    Object.defineProperty(event, 'target', { value: target, enumerable: true });
  }
  act(() => {
    if (target !== undefined) {
      target.dispatchEvent(event);
    } else {
      window.dispatchEvent(event);
    }
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useKeyboardShortcuts', () => {
  it('navigates on a "g m" sequence', () => {
    const handlers = makeSpies();
    render(<Harness handlers={handlers} />);

    press('g');
    expect(handlers.navigate).not.toHaveBeenCalled();
    press('m');

    expect(handlers.navigate).toHaveBeenCalledTimes(1);
    expect(handlers.navigate).toHaveBeenCalledWith('matrix');
  });

  it('opens the help overlay on "?"', () => {
    const handlers = makeSpies();
    render(<Harness handlers={handlers} />);

    press('?', { shiftKey: true });

    expect(handlers.openHelp).toHaveBeenCalledTimes(1);
  });

  it('opens settings on ","', () => {
    const handlers = makeSpies();
    render(<Harness handlers={handlers} />);

    press(',');

    expect(handlers.openSettings).toHaveBeenCalledTimes(1);
  });

  it('ignores keydown events that carry metaKey so ⌘K passes through', () => {
    const handlers = makeSpies();
    render(<Harness handlers={handlers} />);

    press('k', { metaKey: true });
    press('g', { ctrlKey: true });

    expect(handlers.navigate).not.toHaveBeenCalled();
    expect(handlers.openHelp).not.toHaveBeenCalled();
  });

  it('does not trigger while typing in an input element', () => {
    const handlers = makeSpies();
    const input = document.createElement('input');
    document.body.appendChild(input);
    render(<Harness handlers={handlers} />);

    press('g', {}, input);
    press('i', {}, input);

    expect(handlers.navigate).not.toHaveBeenCalled();
    input.remove();
  });

  it('does not trigger while typing in a contenteditable element', () => {
    const handlers = makeSpies();
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);
    render(<Harness handlers={handlers} />);

    press('?', { shiftKey: true }, editable);

    expect(handlers.openHelp).not.toHaveBeenCalled();
    editable.remove();
  });

  it('resets the pending prefix after the sequence timeout', () => {
    vi.useFakeTimers();
    const handlers = makeSpies();
    render(<Harness handlers={handlers} />);

    press('g');
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    press('m');

    expect(handlers.navigate).not.toHaveBeenCalled();
  });

  it('ignores keydown events that carry altKey', () => {
    const handlers = makeSpies();
    render(<Harness handlers={handlers} />);

    press('g', { altKey: true });
    press('i', { altKey: true });

    expect(handlers.navigate).not.toHaveBeenCalled();
    expect(handlers.openHelp).not.toHaveBeenCalled();
    expect(handlers.openSettings).not.toHaveBeenCalled();
  });

  it('resets a pending "g" prefix when Escape is pressed', () => {
    const handlers = makeSpies();
    render(<Harness handlers={handlers} />);

    press('g');
    press('Escape');
    press('i');

    expect(handlers.navigate).not.toHaveBeenCalled();
  });

  it('does not act while a modal is open, but resumes once it closes', () => {
    const handlers = makeSpies();
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    render(<Harness handlers={handlers} />);

    press('g');
    press('i');
    expect(handlers.navigate).not.toHaveBeenCalled();

    modal.remove();

    press('g');
    press('i');
    expect(handlers.navigate).toHaveBeenCalledTimes(1);
    expect(handlers.navigate).toHaveBeenCalledWith('inbox');
  });

  it('removes its keydown listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const handlers = makeSpies();
    const { unmount } = render(<Harness handlers={handlers} />);

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

    press('g');
    press('i');
    expect(handlers.navigate).not.toHaveBeenCalled();
  });
});
