import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsOverlay } from './SettingsOverlay';
import type { AuthUser } from '../types/auth';
import type { FleetView } from '../lib/view-preference';

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches,
      media: '(prefers-color-scheme: dark)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

const USER: AuthUser = { login: 'octocat', avatarUrl: undefined };

interface HarnessProps {
  user?: AuthUser | null;
  onForget?: () => void;
  defaultView?: FleetView;
  onDefaultViewChange?: (view: FleetView) => void;
}

function Harness({
  user = USER,
  onForget = vi.fn(),
  defaultView = 'triage',
  onDefaultViewChange = vi.fn(),
}: HarnessProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open settings
      </button>
      {open ? (
        <SettingsOverlay
          user={user}
          onForget={onForget}
          defaultView={defaultView}
          onDefaultViewChange={onDefaultViewChange}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  stubMatchMedia(false);
});

afterEach(() => {
  localStorage.clear();
});

describe('SettingsOverlay', () => {
  it('renders as a labelled modal dialog', () => {
    render(
      <SettingsOverlay
        user={USER}
        onForget={vi.fn()}
        defaultView="triage"
        onDefaultViewChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName(/settings/i);
  });

  it('consolidates the theme, density and default-view controls', () => {
    render(
      <SettingsOverlay
        user={USER}
        onForget={vi.fn()}
        defaultView="triage"
        onDefaultViewChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('radiogroup', { name: /theme/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('radiogroup', { name: /density/i })).toBeInTheDocument();
    expect(
      within(dialog).getByRole('radiogroup', { name: /repository names/i }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('radiogroup', { name: /default view/i })).toBeInTheDocument();
  });

  it('surfaces a labelled repository-names control in the Appearance section', () => {
    render(
      <SettingsOverlay
        user={USER}
        onForget={vi.fn()}
        defaultView="triage"
        onDefaultViewChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    // The visible label sits alongside the control's own aria-label.
    expect(within(dialog).getByText('Repository names')).toBeInTheDocument();
    const group = within(dialog).getByRole('radiogroup', { name: /repository names/i });
    expect(within(group).getByRole('radio', { name: /show owner/i })).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: /name only/i })).toBeInTheDocument();
  });

  it('shows the authenticated identity and a Forget token action', async () => {
    const onForget = vi.fn();
    const user = userEvent.setup();
    render(
      <SettingsOverlay
        user={USER}
        onForget={onForget}
        defaultView="triage"
        onDefaultViewChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/authenticated as octocat/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /forget token/i }));
    expect(onForget).toHaveBeenCalledTimes(1);
  });

  it('hides the account and defaults sections when unauthenticated', () => {
    render(
      <SettingsOverlay
        user={null}
        onForget={vi.fn()}
        defaultView="triage"
        onDefaultViewChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('radiogroup', { name: /theme/i })).toBeInTheDocument();
    expect(
      within(dialog).getByRole('radiogroup', { name: /repository names/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /forget token/i })).toBeNull();
    expect(within(dialog).queryByRole('radiogroup', { name: /default view/i })).toBeNull();
  });

  it('toggling the theme inside the overlay still works', async () => {
    const user = userEvent.setup();
    render(
      <SettingsOverlay
        user={USER}
        onForget={vi.fn()}
        defaultView="triage"
        onDefaultViewChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const themeGroup = screen.getByRole('radiogroup', { name: /theme/i });
    await user.click(within(themeGroup).getByRole('radio', { name: /dark/i }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('fleet:theme')).toBe('dark');
  });

  it('forwards default-view changes to the handler', async () => {
    const onDefaultViewChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SettingsOverlay
        user={USER}
        onForget={vi.fn()}
        defaultView="triage"
        onDefaultViewChange={onDefaultViewChange}
        onClose={vi.fn()}
      />,
    );

    const group = screen.getByRole('radiogroup', { name: /default view/i });
    await user.click(within(group).getByRole('radio', { name: /inbox/i }));

    expect(onDefaultViewChange).toHaveBeenCalledWith('inbox');
  });

  it('moves focus into the dialog when it opens', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /open settings/i }));

    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
  });

  it('closes on Escape and returns focus to the opener', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const opener = screen.getByRole('button', { name: /open settings/i });
    await user.click(opener);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });

  it('closes when the backdrop is clicked', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /open settings/i }));
    await user.click(screen.getByTestId('settings-backdrop'));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('traps Tab focus within the dialog', async () => {
    const user = userEvent.setup();
    render(
      <SettingsOverlay
        user={USER}
        onForget={vi.fn()}
        defaultView="triage"
        onDefaultViewChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 25; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('wraps focus to the last control on Shift+Tab from the first', async () => {
    const user = userEvent.setup();
    render(
      <SettingsOverlay
        user={USER}
        onForget={vi.fn()}
        defaultView="triage"
        onDefaultViewChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    // The close button receives focus on open and is the first focusable.
    const closeButton = within(dialog).getByRole('button', { name: /close settings/i });
    await waitFor(() => expect(closeButton).toHaveFocus());

    await user.tab({ shift: true });

    expect(within(dialog).getByRole('button', { name: /forget token/i })).toHaveFocus();
  });

  it('wraps focus to the last control on Shift+Tab when unauthenticated', async () => {
    const user = userEvent.setup();
    render(
      <SettingsOverlay
        user={null}
        onForget={vi.fn()}
        defaultView="triage"
        onDefaultViewChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const closeButton = within(dialog).getByRole('button', { name: /close settings/i });
    await waitFor(() => expect(closeButton).toHaveFocus());

    await user.tab({ shift: true });

    // When unauthenticated, the last focusable is in the Repository names radiogroup
    const repoGroup = within(dialog).getByRole('radiogroup', { name: /repository names/i });
    const lastRadio = within(repoGroup).getAllByRole('radio').at(-1);
    expect(lastRadio).toHaveFocus();
  });

  it('closes the overlay after clicking Forget token', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const opener = screen.getByRole('button', { name: /open settings/i });
    await user.click(opener);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /forget token/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('still closes the overlay if onForget throws', async () => {
    const onForgetThatThrows = vi.fn().mockImplementation(() => {
      throw new Error('localStorage SecurityError');
    });
    const user = userEvent.setup();
    render(<Harness onForget={onForgetThatThrows} />);

    const opener = screen.getByRole('button', { name: /open settings/i });
    await user.click(opener);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /forget token/i }));

    // The overlay should still close even though onForget threw
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onForgetThatThrows).toHaveBeenCalledTimes(1);
  });
});
