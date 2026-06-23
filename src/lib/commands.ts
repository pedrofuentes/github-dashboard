/**
 * buildCommandRegistry — a pure factory that maps the app's existing handlers
 * into the flat {@link CommandItem} list rendered by the ⌘K {@link CommandPalette}.
 *
 * It introduces NO new behaviour: every `run` simply calls a callback the caller
 * already owns (view navigation, the settings overlay, the faceted repo filter,
 * theme/density). Keeping it free of React/state makes the registry trivially
 * unit-testable and lets {@link App} layer recents tracking on top.
 */
import type { CommandItem } from '../components/CommandPalette';
import type { FleetView } from './view-preference';

/** The app callbacks each command delegates to (no new behaviour is added). */
export interface CommandRegistryHandlers {
  /** Switch the live fleet view. */
  navigate: (view: FleetView) => void;
  /** Open the settings overlay. */
  openSettings: () => void;
  /** Filter to repos needing attention (health: broken). */
  filterNeedsAttention: () => void;
  /** Filter to repos with pull requests awaiting my review. */
  filterAwaitingReview: () => void;
  /** Filter to repos with failing CI. */
  filterFailingCi: () => void;
  /** Filter to repos at security risk (max grade threshold). */
  filterSecurityRisk: () => void;
  /** Filter to repos with stale items. */
  filterStale: () => void;
  /** Clear every active filter. */
  clearFilters: () => void;
  /** Toggle between light and dark theme. */
  toggleTheme: () => void;
  /** Toggle between balanced and glanceable density. */
  toggleDensity: () => void;
}

/** Builds the full, grouped command registry from the supplied handlers. */
export function buildCommandRegistry(handlers: CommandRegistryHandlers): CommandItem[] {
  return [
    {
      id: 'nav-triage',
      label: 'Go to Triage',
      group: 'Navigation',
      keywords: ['triage', 'view', 'switch', 'worst', 'attention'],
      run: () => handlers.navigate('triage'),
    },
    {
      id: 'nav-matrix',
      label: 'Go to Matrix',
      group: 'Navigation',
      keywords: ['matrix', 'view', 'switch', 'signals'],
      run: () => handlers.navigate('matrix'),
    },
    {
      id: 'nav-grid',
      label: 'Go to Grid',
      group: 'Navigation',
      keywords: ['grid', 'view', 'switch', 'table'],
      run: () => handlers.navigate('grid'),
    },
    {
      id: 'nav-inbox',
      label: 'Go to Inbox',
      group: 'Navigation',
      keywords: ['inbox', 'view', 'switch', 'unread', 'notifications'],
      run: () => handlers.navigate('inbox'),
    },
    {
      id: 'nav-boards',
      label: 'Go to Boards',
      group: 'Navigation',
      keywords: ['boards', 'dashboard', 'view', 'switch', 'tiles', 'layout'],
      run: () => handlers.navigate('dashboard'),
    },
    {
      id: 'open-settings',
      label: 'Open Settings',
      group: 'Settings',
      keywords: ['settings', 'preferences', 'options', 'configure', 'defaults'],
      run: () => handlers.openSettings(),
    },
    {
      id: 'filter-needs-attention',
      label: 'Filter: Needs attention',
      group: 'Filter',
      keywords: ['filter', 'broken', 'health', 'attention', 'failing', 'red'],
      run: () => handlers.filterNeedsAttention(),
    },
    {
      id: 'filter-awaiting-review',
      label: 'Filter: Awaiting my review',
      group: 'Filter',
      keywords: ['filter', 'review', 'awaiting', 'pull request', 'pr', 'me'],
      run: () => handlers.filterAwaitingReview(),
    },
    {
      id: 'filter-failing-ci',
      label: 'Filter: Failing CI',
      group: 'Filter',
      keywords: ['filter', 'ci', 'failing', 'actions', 'build', 'red'],
      run: () => handlers.filterFailingCi(),
    },
    {
      id: 'filter-security-risk',
      label: 'Filter: Security risk',
      group: 'Filter',
      keywords: ['filter', 'security', 'risk', 'alerts', 'vulnerability', 'grade'],
      run: () => handlers.filterSecurityRisk(),
    },
    {
      id: 'filter-stale',
      label: 'Filter: Stale',
      group: 'Filter',
      keywords: ['filter', 'stale', 'old', 'inactive', 'aging'],
      run: () => handlers.filterStale(),
    },
    {
      id: 'filter-clear',
      label: 'Clear all filters',
      group: 'Filter',
      keywords: ['filter', 'clear', 'reset', 'all', 'remove'],
      run: () => handlers.clearFilters(),
    },
    {
      id: 'toggle-theme',
      label: 'Toggle theme',
      group: 'Appearance',
      keywords: ['theme', 'dark', 'light', 'appearance', 'mode', 'color'],
      run: () => handlers.toggleTheme(),
    },
    {
      id: 'toggle-density',
      label: 'Toggle density',
      group: 'Appearance',
      keywords: ['density', 'compact', 'balanced', 'glanceable', 'appearance', 'spacing'],
      run: () => handlers.toggleDensity(),
    },
  ];
}
