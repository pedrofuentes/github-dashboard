import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { AppFooter } from './components/AppFooter';
import { CommandPalette } from './components/CommandPalette';
import type { CommandItem } from './components/CommandPalette';
import { BoardView } from './components/board/BoardView';
import { DeckCustomizePanel } from './components/board/DeckCustomizePanel';
import { DeckSizeControl } from './components/board/DeckSizeControl';
import { FullWindowOverlay } from './components/FullWindowOverlay';
import { CustomizePanel } from './components/CustomizePanel';
import { DashboardView } from './components/DashboardView';
import { DrillDownDrawer } from './components/DrillDownDrawer';
import { FacetedRepoFilter } from './components/FacetedRepoFilter';
import { FleetGrid } from './components/FleetGrid';
import { FleetLoadingBanner } from './components/FleetLoadingBanner';
import { FleetMatrix } from './components/FleetMatrix';
import { InboxView } from './components/inbox/InboxView';
import { SavedViewsMenu } from './components/SavedViewsMenu';
import { SecurityAccessNotice } from './components/SecurityAccessNotice';
import { SettingsOverlay } from './components/SettingsOverlay';
import { ShortcutsHelpOverlay } from './components/ShortcutsHelpOverlay';
import { TokenInput } from './components/TokenInput';
import { UpdateAvailableToast } from './components/UpdateAvailableToast';
import { TriageView } from './components/TriageView';
import { AuthProvider } from './hooks/AuthProvider';
import { FleetUiStateProvider } from './hooks/FleetUiStateProvider';
import { useAliases } from './hooks/useAliases';
import { useAuth } from './hooks/useAuth';
import { useCommandPalette } from './hooks/useCommandPalette';
import { useDashboardLayout } from './hooks/useDashboardLayout';
import { useDeckVisibility } from './hooks/useDeckVisibility';
import { useDeckTileSize } from './hooks/useDeckTileSize';
import { useDeckOrder } from './hooks/useDeckOrder';
import { useDensity } from './hooks/useDensity';
import { useRepoOwner } from './hooks/useRepoOwner';
import { useInbox } from './hooks/useInbox';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useRepoFilterQuery } from './hooks/useRepoFilterQuery';
import { useRepoSignals } from './hooks/useRepoSignals';
import { useRepos } from './hooks/useRepos';
import { useSavedViews } from './hooks/useSavedViews';
import { useTheme } from './hooks/useTheme';
import { useUpdateAvailable } from './hooks/useUpdateAvailable';
import { addCommandRecent, createCommandRecentsStore } from './lib/command-recents';
import { buildCommandRegistry } from './lib/commands';
import { DECK_SIGNALS } from './lib/deck-visibility';
import { loadDefaultView, saveDefaultView } from './lib/default-view-preference';
import type { SavedView } from './lib/saved-views';
import { hasNoSecurityAccess } from './lib/security-access';
import type { VersionedStore } from './lib/versioned-storage';
import { buildViewPresets } from './lib/view-presets';
import type { FleetView } from './lib/view-preference';
import type { TileSignalType } from './types/dashboard';
import type { Repo, RepoSignalData, SignalStatus } from './types/fleet';

export function App(): ReactElement {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell(): ReactElement {
  const { status, user, token, forget } = useAuth();
  const authenticated = status === 'authenticated' && user !== null;
  const { updateAvailable, deployedSha } = useUpdateAvailable();

  // Lifted here so the single header Settings overlay (Defaults section) and the
  // authenticated FleetPanel (ViewToggle + rendered surface) share ONE source of
  // truth for the live and persisted views. Changing the default also switches
  // the live view, preserving the prior DefaultViewToggle behaviour.
  const [view, setView] = useState<FleetView>(loadDefaultView);
  const [defaultView, setDefaultView] = useState<FleetView>(loadDefaultView);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleViewChange = useCallback((next: FleetView) => setView(next), []);
  const handleDefaultViewChange = useCallback((next: FleetView) => {
    if (!saveDefaultView(next)) {
      return;
    }
    setDefaultView(next);
    setView(next);
  }, []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  // Shell never unmounts across auth transitions, so its lazy `view` initializer
  // runs only once. Mirror the pre-refactor FleetPanel remount: whenever the app
  // returns to unauthenticated, reset the live view to the persisted default so a
  // fresh in-session sign-in always opens to the configured default (not the
  // previously-selected live view). `defaultView` stays in sync via
  // handleDefaultViewChange.
  useEffect(() => {
    if (!authenticated) {
      setView(loadDefaultView());
    }
  }, [authenticated]);

  return (
    <div className="min-h-screen bg-bg text-text">
      <UpdateAvailableToast updateAvailable={updateAvailable} deployedSha={deployedSha} />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-4 focus:py-2 focus:font-medium focus:text-text focus:shadow-lg focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-focus"
      >
        Skip to main content
      </a>
      <header className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">github-dashboard</h1>
            <p className="mt-2 text-text-muted">
              Fleet health for your GitHub repositories, at a glance.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={openSettings}
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 py-1 text-sm font-medium text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <GearIcon />
              <span>Settings</span>
            </button>
          </div>
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        aria-labelledby="overview-heading"
        className="mx-auto max-w-5xl px-6 pb-12 outline-none"
      >
        <h2 id="overview-heading" className="sr-only">
          Fleet overview
        </h2>
        {authenticated ? (
          <FleetPanel
            token={token}
            viewerLogin={user?.login ?? null}
            view={view}
            onViewChange={handleViewChange}
            onOpenSettings={openSettings}
          />
        ) : (
          <TokenInput />
        )}
      </main>
      <AppFooter />
      {settingsOpen ? (
        <SettingsOverlay
          defaultView={defaultView}
          onDefaultViewChange={handleDefaultViewChange}
          user={authenticated ? user : null}
          onForget={forget}
          onClose={closeSettings}
        />
      ) : null}
    </div>
  );
}

const GEAR_ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function GearIcon(): ReactElement {
  return (
    <svg {...GEAR_ICON_PROPS}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** The per-repo signal slots populated asynchronously after the repo list loads. */
const SIGNAL_KEYS = ['ci', 'security', 'reviews', 'pullRequests', 'issues', 'stale'] as const;

/** Signal statuses that mean a slice has finished loading (settled, not in-flight). */
const RESOLVED_SIGNAL_STATUSES = new Set<SignalStatus>(['ready', 'error']);

/**
 * Whether a repo's signal data has settled — `true` only once **every** slice
 * has settled (`ready`/`error`). While any slice is still absent or `loading`
 * the derived inbox for that repo is incomplete: ids from the not-yet-loaded
 * slices are missing from the live set, so advancing the watermark (and pruning
 * triage against that partial set) would wrongly GC their read/dismissed marks.
 * A failed fetch becomes `error`, which counts as settled, so this still becomes
 * true eventually — there is no permanent stall on a slice that never loads.
 */
function repoSignalsResolved(data: RepoSignalData): boolean {
  return SIGNAL_KEYS.every((key) => {
    const slice = data[key];
    return slice !== undefined && RESOLVED_SIGNAL_STATUSES.has(slice.status);
  });
}

interface FleetPanelProps {
  token: string | null;
  /** Authenticated viewer's GitHub login, threaded to the issues signal so it
   *  can split open issues into "mine" vs "community"; `null` when unavailable. */
  viewerLogin: string | null;
  /** The live view, owned by {@link Shell} so the Settings overlay can drive it. */
  view: FleetView;
  /** Switches the live view (e.g. from the in-panel ViewToggle). */
  onViewChange: (view: FleetView) => void;
  /** Opens the Settings overlay (owned by {@link Shell}); wired to the ⌘K palette. */
  onOpenSettings: () => void;
}

function FleetPanel({
  token,
  viewerLogin,
  view,
  onViewChange,
  onOpenSettings,
}: FleetPanelProps): ReactElement {
  const { repos, status, error, reload } = useRepos(token);
  const {
    getRowData,
    retrySignal,
    fleet = { loading: false, ready: repos.length, total: repos.length },
  } = useRepoSignals(repos, token, viewerLogin);
  const viewLoading = status === 'loading' || fleet.loading;
  // Lifted ONCE here (red-team B-1): the SAME layout instance drives both the
  // DashboardView grid and the sibling CustomizePanel, so the tile picker and
  // the grid never desync. Aliases + repo filter are owned alongside it.
  const { layout, setLayout, reset } = useDashboardLayout(repos);
  const aliases = useAliases(repos);
  const filter = useRepoFilterQuery(repos, getRowData);
  const saved = useSavedViews();
  const presets = useMemo(() => buildViewPresets(), []);
  const inbox = useInbox(repos, getRowData);
  const { markAllSeen } = inbox;
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [editing, setEditing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const deck = useDeckVisibility();
  const { size: deckTileSize } = useDeckTileSize();
  const [deckEditing, setDeckEditing] = useState(false);
  const [fullWindow, setFullWindow] = useState(false);

  // Power-user keyboard navigation: the `g …` sequences switch views, `?` opens
  // the shortcuts help overlay, and `,` opens Settings. The hook installs ONE
  // global listener and ignores keystrokes while typing in inputs, so it never
  // collides with the filter/search fields or the ⌘K palette (which owns its own
  // ⌘K/Ctrl-K listener via `useCommandPalette`).
  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  useKeyboardShortcuts({ navigate: onViewChange, openHelp, openSettings: onOpenSettings });

  // Edit affordances only make sense on the dashboard; leaving it (whether via
  // the in-panel ViewToggle or the Settings overlay's default-view change, both
  // of which flow through the lifted `view`) drops edit mode.
  useEffect(() => {
    if (view !== 'dashboard') {
      setEditing(false);
    }
  }, [view]);

  // Deck edit affordances likewise only make sense on the Deck; leaving it drops
  // edit mode so returning doesn't re-show the inline ✕ overlay + customize panel.
  useEffect(() => {
    if (view !== 'deck') {
      setDeckEditing(false);
    }
  }, [view]);

  // The per-repo signals load asynchronously after the repo list resolves, so a
  // `status === 'success'` render can still have an incomplete derived inbox.
  // Treat the fleet as settled only once every repo has every signal slice
  // resolved, so the live ids the watermark GC runs against are complete — a repo
  // with even one slice still loading would otherwise prune triage for the ids of
  // its not-yet-loaded slices.
  const signalsResolved = useMemo(
    () => repos.every((repo) => repoSignalsResolved(getRowData(repo))),
    [repos, getRowData],
  );

  // Every primary surface honours the active faceted filter — the repo scope is
  // global across views (ADR-027). When the filter narrows the fleet, the matrix,
  // triage, grid and inbox render ONLY the matching repos; with no active filter
  // they show the whole fleet. Memoised so the worst-first models only recompute
  // when the fleet or selection changes.
  const filteredRepos = useMemo(
    () =>
      filter.isActive
        ? repos.filter((repo) => filter.derivedSelected.has(repo.nameWithOwner))
        : repos,
    [repos, filter.isActive, filter.derivedSelected],
  );
  const securityNoAccess = useMemo(
    () => hasNoSecurityAccess(repos.map((repo) => getRowData(repo).security)),
    [repos, getRowData],
  );

  // Advance the "last visited" watermark once per Inbox visit, but only after the
  // signals have settled so the hook's triage GC runs against the real live ids
  // (never the transiently-empty set of the load window, which would drop every
  // read/dismissed mark). Leaving the Inbox re-arms it so the next open re-stamps
  // the watermark (AC-16).
  const inboxSeenRef = useRef(false);
  useEffect(() => {
    if (view !== 'inbox') {
      inboxSeenRef.current = false;
      return;
    }
    if (status === 'success' && signalsResolved && !inboxSeenRef.current) {
      inboxSeenRef.current = true;
      markAllSeen();
    }
  }, [view, status, signalsResolved, markAllSeen]);

  // Stable callbacks so the memoised grid rows keep shallow-equal props and do
  // not all re-render when the drawer opens or closes.
  const handleRepoActivate = useCallback((repo: Repo) => setSelectedRepo(repo), []);
  const handleCloseDrawer = useCallback(() => setSelectedRepo(null), []);
  const handleToggleEditing = useCallback(() => setEditing((current) => !current), []);
  // Closing the CustomizePanel (Esc, backdrop, ✕) leaves edit mode, which also
  // unmounts the panel via the `editing` coupling and returns focus to the opener.
  const handleCloseCustomize = useCallback(() => setEditing(false), []);

  // Deck customize: mirrors the dashboard editing/CustomizePanel pattern.
  const handleToggleDeckEditing = useCallback(() => setDeckEditing((c) => !c), []);
  const handleCloseDeckCustomize = useCallback(() => setDeckEditing(false), []);

  // Full-window (immersive) mode shows only the active view full-bleed. Entering
  // drops both edit modes — full-window is for reading, not arranging — so the
  // view renders calm; the bar's Exit control and Esc leave it.
  const enterFullWindow = useCallback(() => {
    setEditing(false);
    setDeckEditing(false);
    setFullWindow(true);
  }, []);
  const exitFullWindow = useCallback(() => setFullWindow(false), []);

  // Entering full-window unmounts the toolbar (so the opener button is gone by
  // the time the overlay mounts — its own restore would land on <body>). Own the
  // restoration here: when we leave full-window, return focus to the re-mounted
  // Full window button so keyboard/screen-reader users aren't dropped to <body>.
  const fullWindowButtonRef = useRef<HTMLButtonElement>(null);
  const wasFullWindowRef = useRef(false);
  useEffect(() => {
    if (wasFullWindowRef.current && !fullWindow) {
      fullWindowButtonRef.current?.focus();
    }
    wasFullWindowRef.current = fullWindow;
  }, [fullWindow]);
  // Full repos (not filteredRepos) so fleet-wide bulk ops cover every repo.
  const repoNames = useMemo(() => repos.map((r) => r.nameWithOwner), [repos]);
  // Deck matrix row/column order (persisted, reconciled against the fleet).
  const {
    repoOrder: deckRepoOrder,
    signalOrder: deckSignalOrder,
    moveRepo: deckMoveRepo,
  } = useDeckOrder(repoNames);
  // Destructure stable callbacks from `deck` so exhaustive-deps sees direct refs.
  const {
    toggleKey: deckToggleKey,
    setSignal: deckSetSignal,
    setRepo: deckSetRepo,
    setAll: deckSetAll,
    showOnly: deckShowOnly,
  } = deck;
  // Stable BoardView toggle adapter (feeds memoised grid rows).
  const handleDeckToggleKey = useCallback(
    (repo: Repo, signal: TileSignalType) => deckToggleKey(repo.nameWithOwner, signal),
    [deckToggleKey],
  );
  // Stable panel adapters bridging the hook's array-taking mutators to the panel.
  const handleDeckSetSignal = useCallback(
    (signal: TileSignalType, hide: boolean) => deckSetSignal(repoNames, signal, hide),
    [deckSetSignal, repoNames],
  );
  const handleDeckSetRepo = useCallback(
    (repo: string, hide: boolean) => deckSetRepo(repo, DECK_SIGNALS, hide),
    [deckSetRepo],
  );
  const handleDeckSetAll = useCallback(
    (hide: boolean) => deckSetAll(repoNames, DECK_SIGNALS, hide),
    [deckSetAll, repoNames],
  );
  const handleDeckShowOnly = useCallback(
    (keep: Set<TileSignalType>) => deckShowOnly(repoNames, DECK_SIGNALS, keep),
    [deckShowOnly, repoNames],
  );

  // Applying a saved view (or built-in preset) atomically restores its repo
  // filter and switches to its target view — the visible payoff of Saved Views.
  // `sort`/`density` are not centrally tracked here, so only filter + view are
  // restored (matching what the menu captures on save).
  const handleApplySavedView = useCallback(
    (savedView: SavedView) => {
      filter.applyQuery(savedView.filter);
      onViewChange(savedView.view);
    },
    [filter, onViewChange],
  );

  // ⌘K command palette: a global, app-wide command surface. The hook owns the
  // open state + the ⌘K/Ctrl-K listener; the registry below maps existing
  // handlers (navigation, filter presets, settings, appearance) to commands —
  // adding NO new behaviour, only a faster way to reach what already exists.
  const { open: paletteOpen, closePalette } = useCommandPalette();

  const { resolved, setChoice } = useTheme();
  const { density, setDensity } = useDensity();
  const { display, setDisplay } = useRepoOwner();
  const toggleTheme = useCallback(
    () => setChoice(resolved === 'dark' ? 'light' : 'dark'),
    [resolved, setChoice],
  );
  const toggleDensity = useCallback(
    () => setDensity(density === 'balanced' ? 'glanceable' : 'balanced'),
    [density, setDensity],
  );
  const toggleRepoOwner = useCallback(
    () => setDisplay(display === 'show' ? 'hide' : 'show'),
    [display, setDisplay],
  );

  // A tiny localStorage-backed list of recently-run command ids, surfaced as the
  // palette's "Recent" section for an empty query. Reuses the shared versioned
  // store; failures degrade to an empty list (never throw).
  const recentsStoreRef = useRef<VersionedStore<string[]> | null>(null);
  if (recentsStoreRef.current === null) {
    recentsStoreRef.current = createCommandRecentsStore();
  }
  const recentsStore = recentsStoreRef.current;
  const [commandRecents, setCommandRecents] = useState<string[]>(() => recentsStore.load());
  const recordCommandRecent = useCallback(
    (id: string) => {
      setCommandRecents((current) => {
        const next = addCommandRecent(current, id);
        recentsStore.save(next);
        return next;
      });
    },
    [recentsStore],
  );

  const { toggleHealth, toggleReviewsAwaitingMe, toggleCi, setSecurityMaxGrade, toggleStale } =
    filter;
  const clearAllFilters = filter.clearAll;
  const commands = useMemo<CommandItem[]>(() => {
    const base = buildCommandRegistry({
      navigate: onViewChange,
      openSettings: onOpenSettings,
      filterNeedsAttention: () => toggleHealth('broken'),
      filterAwaitingReview: () => toggleReviewsAwaitingMe(),
      filterFailingCi: () => toggleCi('failure'),
      filterSecurityRisk: () => setSecurityMaxGrade('C'),
      filterStale: () => toggleStale('any'),
      clearFilters: () => clearAllFilters(),
      toggleTheme,
      toggleDensity,
      toggleRepoOwner,
    });
    // Record each command as recent when it runs (before delegating), so the
    // recents list reflects usage even from keyboard activation.
    return base.map((command) => ({
      ...command,
      run: () => {
        recordCommandRecent(command.id);
        command.run();
      },
    }));
  }, [
    onViewChange,
    onOpenSettings,
    toggleHealth,
    toggleReviewsAwaitingMe,
    toggleCi,
    setSecurityMaxGrade,
    toggleStale,
    clearAllFilters,
    toggleTheme,
    toggleDensity,
    toggleRepoOwner,
    recordCommandRecent,
  ]);

  // The active view's label, used for the full-window bar + region name.
  const viewLabel = VIEW_OPTIONS.find((option) => option.value === view)?.label ?? 'Fleet';

  // The active view surface — rendered either in the normal layout or, in
  // full-window mode, inside the immersive overlay (the SAME element, so it is
  // never mounted twice). Edit panels ride along but are null in full-window
  // (entering it drops both edit modes).
  const viewSurface =
    view === 'triage' ? (
      <TriageView
        repos={filteredRepos}
        getRowData={getRowData}
        onRepoActivate={handleRepoActivate}
        loading={viewLoading}
        error={status === 'error' ? error : null}
        onRetry={reload}
      />
    ) : view === 'matrix' ? (
      <FleetMatrix
        repos={filteredRepos}
        getRowData={getRowData}
        onRepoActivate={handleRepoActivate}
        loading={viewLoading}
        error={status === 'error' ? error : null}
        onRetry={reload}
      />
    ) : view === 'dashboard' ? (
      <>
        <DashboardView
          repos={repos}
          getRowData={getRowData}
          onRepoActivate={handleRepoActivate}
          editing={editing}
          layout={layout}
          onLayoutChange={setLayout}
          repoFilter={filter.isActive ? filter.derivedSelected : undefined}
          onClearFilter={filter.clearAll}
          aliases={aliases.aliases}
          loading={viewLoading}
          error={status === 'error' ? error : null}
          onRetry={reload}
        />
        {editing ? (
          <CustomizePanel
            layout={layout}
            onLayoutChange={setLayout}
            onReset={reset}
            aliases={aliases.aliases}
            onSetAlias={aliases.setAlias}
            onClearAlias={aliases.clearAlias}
            onClose={handleCloseCustomize}
          />
        ) : null}
      </>
    ) : view === 'inbox' ? (
      <InboxView
        inbox={inbox}
        repos={filteredRepos}
        repoScope={filter.isActive ? filter.derivedSelected : undefined}
        loading={viewLoading}
        error={status === 'error' ? error : null}
        onRetry={reload}
      />
    ) : view === 'deck' ? (
      <>
        <BoardView
          repos={repos}
          getRowData={getRowData}
          onRepoActivate={handleRepoActivate}
          loading={viewLoading}
          error={status === 'error' ? error : null}
          onRetry={reload}
          onRetrySignal={retrySignal}
          repoFilter={filter.isActive ? filter.derivedSelected : undefined}
          hiddenKeys={deck.hidden}
          editing={deckEditing}
          onToggleKey={handleDeckToggleKey}
          size={deckTileSize}
          repoOrder={deckRepoOrder}
          signalOrder={deckSignalOrder}
          onMoveRepo={deckMoveRepo}
        />
        {deckEditing ? (
          <DeckCustomizePanel
            repos={repos}
            hidden={deck.hidden}
            onToggleKey={deck.toggleKey}
            onSetSignal={handleDeckSetSignal}
            onSetRepo={handleDeckSetRepo}
            onSetAll={handleDeckSetAll}
            onShowOnly={handleDeckShowOnly}
            onReset={deck.reset}
            onClose={handleCloseDeckCustomize}
          />
        ) : null}
      </>
    ) : (
      <FleetGrid
        repos={filteredRepos}
        getRowData={getRowData}
        loading={viewLoading}
        error={status === 'error' ? error : null}
        onRetry={reload}
        onRepoActivate={handleRepoActivate}
      />
    );

  // App-wide overlays that stay reachable in both layouts (they sit above the
  // full-window surface), so drilling down / the palette / help still work.
  const sharedOverlays = (
    <>
      {selectedRepo !== null ? (
        <DrillDownDrawer
          repo={selectedRepo}
          data={getRowData(selectedRepo)}
          onClose={handleCloseDrawer}
        />
      ) : null}
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        commands={commands}
        recents={commandRecents}
      />
      {helpOpen ? <ShortcutsHelpOverlay onClose={closeHelp} /> : null}
    </>
  );

  return (
    <FleetUiStateProvider>
      {fullWindow ? (
        <>
          <FullWindowOverlay
            label={viewLabel}
            onExit={exitFullWindow}
            controls={view === 'deck' ? <DeckSizeControl /> : undefined}
          >
            {viewSurface}
          </FullWindowOverlay>
          {sharedOverlays}
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <ViewToggle view={view} onChange={onViewChange} unreadCount={inbox.unreadCount} />
            <FacetedRepoFilter repos={repos} filter={filter} />
            {view === 'dashboard' ? (
              <CustomizeLayoutToggle editing={editing} onToggle={handleToggleEditing} />
            ) : null}
            {view === 'deck' ? (
              <CustomizeLayoutToggle
                editing={deckEditing}
                onToggle={handleToggleDeckEditing}
                idleLabel="Customize tiles"
              />
            ) : null}
            {view === 'deck' ? <DeckSizeControl /> : null}
            <FullWindowButton ref={fullWindowButtonRef} onActivate={enterFullWindow} />
            <SavedViewsMenu
              views={saved.views}
              presets={presets}
              currentFilter={filter.query}
              currentView={view}
              onApply={handleApplySavedView}
              onCreate={saved.create}
              onRename={saved.rename}
              onRemove={saved.remove}
            />
          </div>
          <FleetLoadingBanner loading={fleet.loading} ready={fleet.ready} total={fleet.total} />
          <SecurityAccessNotice show={securityNoAccess} />
          {viewSurface}
          {sharedOverlays}
        </div>
      )}
    </FleetUiStateProvider>
  );
}

interface CustomizeLayoutToggleProps {
  editing: boolean;
  onToggle: () => void;
  idleLabel?: string;
  activeLabel?: string;
}

function CustomizeLayoutToggle({
  editing,
  onToggle,
  idleLabel = 'Customize layout',
  activeLabel = 'Done customizing',
}: CustomizeLayoutToggleProps): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={editing}
      onClick={onToggle}
      className={
        editing
          ? 'rounded-md border border-accent-info bg-accent-info px-3 py-1 text-sm font-medium text-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
          : 'rounded-md border border-border-strong bg-surface px-3 py-1 text-sm font-medium text-text-muted hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
      }
    >
      {editing ? activeLabel : idleLabel}
    </button>
  );
}

interface FullWindowButtonProps {
  onActivate: () => void;
}

/** Toolbar control that enters the immersive full-window view (any view). */
const FullWindowButton = forwardRef<HTMLButtonElement, FullWindowButtonProps>(
  function FullWindowButton({ onActivate }, ref): ReactElement {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onActivate}
        className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 py-1 text-sm font-medium text-text-muted hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <svg
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M16 3h3a2 2 0 0 1 2 2v3" />
          <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
        <span>Full window</span>
      </button>
    );
  },
);

interface ViewToggleProps {
  view: FleetView;
  onChange: (view: FleetView) => void;
  unreadCount: number;
}

const VIEW_OPTIONS: ReadonlyArray<{ value: FleetView; label: string }> = [
  { value: 'triage', label: 'Triage' },
  { value: 'matrix', label: 'Matrix' },
  { value: 'grid', label: 'Grid' },
  { value: 'dashboard', label: 'Boards' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'deck', label: 'Deck' },
];

function ViewToggle({ view, onChange, unreadCount }: ViewToggleProps): ReactElement {
  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex w-fit rounded-md border border-border-strong bg-surface p-0.5"
    >
      {VIEW_OPTIONS.map((option) => {
        const isActive = view === option.value;
        const showBadge = option.value === 'inbox' && unreadCount > 0;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={
              isActive
                ? 'inline-flex items-center rounded px-3 py-1 text-sm font-medium bg-text text-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
                : 'inline-flex items-center rounded px-3 py-1 text-sm font-medium text-text-muted hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
            }
          >
            {option.label}
            {showBadge ? (
              <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-accent-info px-1.5 py-0.5 text-xs font-semibold leading-none text-surface">
                {unreadCount}
                <span className="sr-only"> unread</span>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
