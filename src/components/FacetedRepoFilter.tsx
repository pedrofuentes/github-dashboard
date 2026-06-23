/**
 * FacetedRepoFilter — the scalable, faceted repo-scope filter popover (filter
 * v2). It replaces the flat-checkbox `RepoScopeFilter`: a disclosure button
 * summarises the active scope and reveals a token-styled popover with a fuzzy
 * search combobox over the fleet, labelled facet groups (owner, health, CI,
 * security, pull requests, reviews, issues, stale, visibility), a removable
 * active-chip row, and a bulk row (clear all / select owners / invert).
 *
 * Fully CONTROLLED + presentational: the parent owns {@link useRepoFilterQuery}
 * and passes its result straight through. This component holds only local
 * open/closed + keyboard-navigation state. Accessibility mirrors the existing
 * disclosure/dialog patterns: focus moves into the panel on open, `Esc` closes
 * and returns focus to the disclosure button, a click outside closes, the
 * matched-repo count is announced via a polite live region, every facet is a
 * labelled checkbox (non-colour encoding), and the expand affordance honours
 * `prefers-reduced-motion`. Colours use semantic tokens only.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';

import { fuzzyRankBy } from '../lib/fuzzy-match';
import { addRecentFilter, loadRecentFilters } from '../lib/recent-filters';
import type { RepoFilterQueryV2 } from '../lib/repo-filter-query';
import type {
  CiState,
  HealthBand,
  IssuesOption,
  PullRequestOption,
  SecurityGrade,
  SecuritySeverity,
  StaleOption,
  UseRepoFilterQueryResult,
  VisibilityOption,
} from '../hooks/useRepoFilterQuery';
import type { Repo } from '../types/fleet';

interface FacetedRepoFilterProps {
  /** All fleet repositories offered in the search list and owner facet. */
  repos: Repo[];
  /** The controlled filter state from {@link useRepoFilterQuery}. */
  filter: UseRepoFilterQueryResult;
}

/** One selectable facet value with its human-readable label. */
interface FacetOption<T extends string> {
  value: T;
  label: string;
}

const HEALTH_OPTIONS: ReadonlyArray<FacetOption<HealthBand>> = [
  { value: 'broken', label: 'Broken' },
  { value: 'warning', label: 'Warning' },
  { value: 'healthy', label: 'Healthy' },
];

const CI_OPTIONS: ReadonlyArray<FacetOption<CiState>> = [
  { value: 'failure', label: 'Failing CI' },
  { value: 'in_progress', label: 'CI in progress' },
  { value: 'queued', label: 'CI queued' },
  { value: 'success', label: 'Passing CI' },
  { value: 'none', label: 'No CI runs' },
];

const GRADE_OPTIONS: ReadonlyArray<FacetOption<SecurityGrade>> = (
  ['A', 'B', 'C', 'D', 'E', 'F'] as const
).map((grade) => ({ value: grade, label: `Grade ${grade}` }));

const SEVERITY_OPTIONS: ReadonlyArray<FacetOption<SecuritySeverity>> = [
  { value: 'critical', label: 'Critical severity' },
  { value: 'high', label: 'High severity' },
  { value: 'medium', label: 'Medium severity' },
  { value: 'low', label: 'Low severity' },
];

const PR_OPTIONS: ReadonlyArray<FacetOption<PullRequestOption>> = [
  { value: 'open', label: 'Open PRs' },
  { value: 'external', label: 'External PRs' },
];

const ISSUE_OPTIONS: ReadonlyArray<FacetOption<IssuesOption>> = [
  { value: 'open', label: 'Open issues' },
  { value: 'over-threshold', label: 'Issues over threshold' },
];

const STALE_OPTIONS: ReadonlyArray<FacetOption<StaleOption>> = [
  { value: 'any', label: 'Any stale' },
  { value: 'pr', label: 'Stale PRs' },
  { value: 'issue', label: 'Stale issues' },
];

const VISIBILITY_OPTIONS: ReadonlyArray<FacetOption<VisibilityOption>> = [
  { value: 'private', label: 'Private' },
  { value: 'public', label: 'Public' },
];

const DISCLOSURE_BUTTON =
  'inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 py-1 text-sm font-medium text-text-muted hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const CHECKBOX = `h-4 w-4 accent-text ${FOCUS_RING}`;
const CHECKBOX_LABEL = `flex items-center gap-2 rounded px-1.5 py-1 text-sm text-text hover:bg-surface-raised ${FOCUS_RING}`;
const BULK_BUTTON = `rounded border border-border-strong bg-surface px-2 py-0.5 text-xs font-medium text-text-muted hover:bg-surface-raised ${FOCUS_RING}`;

/** One removable active filter, rendered as a chip in the chip row. */
interface ActiveChip {
  key: string;
  label: string;
  remove: () => void;
}

/** Builds the flat list of active chips from the current query. */
function buildChips(
  filter: UseRepoFilterQueryResult,
  togglePin: (name: string) => void,
): ActiveChip[] {
  const { query } = filter;
  const { facets, repoSelection, text } = query;
  const chips: ActiveChip[] = [];

  if (text.trim() !== '') {
    chips.push({
      key: 'text',
      label: `Search: "${text.trim()}"`,
      remove: () => filter.setText(''),
    });
  }
  for (const owner of facets.owners) {
    chips.push({ key: `owner:${owner}`, label: owner, remove: () => filter.toggleOwner(owner) });
  }
  for (const { value, label } of HEALTH_OPTIONS.filter((o) => facets.health.includes(o.value))) {
    chips.push({ key: `health:${value}`, label, remove: () => filter.toggleHealth(value) });
  }
  for (const { value, label } of CI_OPTIONS.filter((o) => facets.ci.includes(o.value))) {
    chips.push({ key: `ci:${value}`, label, remove: () => filter.toggleCi(value) });
  }
  for (const { value, label } of GRADE_OPTIONS.filter((o) =>
    facets.security.grades.includes(o.value),
  )) {
    chips.push({ key: `grade:${value}`, label, remove: () => filter.toggleSecurityGrade(value) });
  }
  if (facets.security.maxGrade !== undefined) {
    chips.push({
      key: 'maxGrade',
      label: `Up to grade ${facets.security.maxGrade}`,
      remove: () => filter.setSecurityMaxGrade(undefined),
    });
  }
  for (const { value, label } of SEVERITY_OPTIONS.filter((o) =>
    facets.security.severities.includes(o.value),
  )) {
    chips.push({
      key: `severity:${value}`,
      label,
      remove: () => filter.toggleSecuritySeverity(value),
    });
  }
  for (const { value, label } of PR_OPTIONS.filter((o) => facets.pullRequests.includes(o.value))) {
    chips.push({ key: `pr:${value}`, label, remove: () => filter.togglePullRequests(value) });
  }
  if (facets.reviews.includes('awaiting-me')) {
    chips.push({
      key: 'reviews',
      label: 'Awaiting my review',
      remove: () => filter.toggleReviewsAwaitingMe(),
    });
  }
  for (const { value, label } of ISSUE_OPTIONS.filter((o) => facets.issues.includes(o.value))) {
    chips.push({ key: `issue:${value}`, label, remove: () => filter.toggleIssues(value) });
  }
  for (const { value, label } of STALE_OPTIONS.filter((o) => facets.stale.includes(o.value))) {
    chips.push({ key: `stale:${value}`, label, remove: () => filter.toggleStale(value) });
  }
  for (const { value, label } of VISIBILITY_OPTIONS.filter((o) =>
    facets.visibility.includes(o.value),
  )) {
    chips.push({ key: `visibility:${value}`, label, remove: () => filter.toggleVisibility(value) });
  }
  if (repoSelection.mode !== 'all') {
    const verb = repoSelection.mode === 'exclude' ? 'Exclude' : 'Pin';
    for (const name of repoSelection.names) {
      chips.push({
        key: `repo:${name}`,
        label: `${verb}: ${name}`,
        remove: () => togglePin(name),
      });
    }
  }
  return chips;
}

/** Builds a short human-readable summary for a recent filter query. */
function summarizeQuery(query: RepoFilterQueryV2): string {
  const parts: string[] = [];
  if (query.text.trim() !== '') {
    parts.push(`"${query.text.trim()}"`);
  }
  const { facets } = query;
  if (facets.owners.length > 0) {
    parts.push(facets.owners.slice(0, 2).join(', '));
  }
  if (facets.health.length > 0) {
    const labels = HEALTH_OPTIONS.filter((o) => facets.health.includes(o.value)).map(
      (o) => o.label,
    );
    parts.push(labels.slice(0, 2).join(', '));
  }
  if (facets.ci.length > 0) {
    const labels = CI_OPTIONS.filter((o) => facets.ci.includes(o.value)).map((o) => o.label);
    parts.push(labels[0] ?? 'CI');
  }
  if (facets.pullRequests.length > 0) {
    parts.push('PRs');
  }
  if (facets.reviews.length > 0) {
    parts.push('Reviews');
  }
  if (facets.issues.length > 0) {
    parts.push('Issues');
  }
  if (facets.stale.length > 0) {
    parts.push('Stale');
  }
  if (facets.visibility.length > 0) {
    parts.push(facets.visibility.join(', '));
  }
  return parts.slice(0, 3).join(' · ') || 'Recent filter';
}

/** A labelled group of facet checkboxes sharing one toggle updater. */
function FacetGroup<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: ReadonlyArray<FacetOption<T>>;
  selected: readonly T[];
  onToggle: (value: T) => void;
}): ReactElement {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1">
      <p className="px-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </p>
      {options.map((option) => (
        <label key={option.value} className={CHECKBOX_LABEL}>
          <input
            type="checkbox"
            checked={selected.includes(option.value)}
            onChange={() => onToggle(option.value)}
            className={CHECKBOX}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

export function FacetedRepoFilter({ repos, filter }: FacetedRepoFilterProps): ReactElement {
  const {
    query,
    derivedSelected,
    isActive,
    availableOwners,
    setText,
    toggleOwner,
    toggleHealth,
    toggleCi,
    toggleSecurityGrade,
    toggleSecuritySeverity,
    togglePullRequests,
    toggleReviewsAwaitingMe,
    toggleIssues,
    toggleStale,
    toggleVisibility,
    toggleRepoPin,
    setRepoSelection,
    clearAll,
    applyQuery,
  } = filter;

  const [expanded, setExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recentFilters, setRecentFilters] = useState<RepoFilterQueryV2[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const listId = useId();
  const optionBaseId = useId();

  // Load recent filters when the panel opens.
  useEffect(() => {
    if (expanded) {
      setRecentFilters(loadRecentFilters());
    }
  }, [expanded]);

  // Record the current query when it becomes active (debounced via useEffect).
  const previousIsActive = useRef(isActive);
  useEffect(() => {
    if (isActive && !previousIsActive.current) {
      addRecentFilter(query);
    }
    previousIsActive.current = isActive;
  }, [isActive, query]);

  const visibleRepos = useMemo(
    () => fuzzyRankBy(query.text, repos, (r) => [r.nameWithOwner, r.owner, r.name]),
    [query.text, repos],
  );

  // Mode-aware repo pin: the hook's `toggleRepoPin` only narrows in
  // `include`/`exclude` mode (evaluate ignores `names` while mode is `all`), so
  // pinning from `all` bootstraps an `include` set, and removing the last
  // include pin falls back to `all` (the canonical "show everything" state).
  const togglePin = useCallback(
    (name: string) => {
      const { mode, names } = query.repoSelection;
      if (mode === 'all') {
        setRepoSelection({ mode: 'include', names: [name] });
      } else if (mode === 'include' && names.length === 1 && names[0] === name) {
        setRepoSelection({ mode: 'all', names: [] });
      } else {
        toggleRepoPin(name);
      }
    },
    [query.repoSelection, setRepoSelection, toggleRepoPin],
  );

  const chips = useMemo(() => buildChips(filter, togglePin), [filter, togglePin]);

  const summary = useMemo(() => {
    if (!isActive) {
      return 'All repositories';
    }
    const n = derivedSelected.size;
    const m = chips.length;
    return `${n} ${n === 1 ? 'repo' : 'repos'} · ${m} ${m === 1 ? 'filter' : 'filters'}`;
  }, [isActive, derivedSelected, chips.length]);

  const matchedCount = visibleRepos.length;
  const announcement = `${matchedCount} ${
    matchedCount === 1 ? 'repository matches' : 'repositories match'
  }`;

  // Focus the search box when the panel opens.
  useEffect(() => {
    if (expanded) {
      searchRef.current?.focus();
    }
  }, [expanded]);

  // Keep the active option within the (possibly newly filtered) list bounds.
  useEffect(() => {
    setActiveIndex((current) =>
      current >= visibleRepos.length ? visibleRepos.length - 1 : current,
    );
  }, [visibleRepos.length]);

  const close = useCallback((returnFocus: boolean) => {
    setExpanded(false);
    setActiveIndex(-1);
    if (returnFocus) {
      buttonRef.current?.focus();
    }
  }, []);

  // Close when a pointer lands outside the button + panel (non-modal popover).
  useEffect(() => {
    if (!expanded) {
      return;
    }
    function handlePointerDown(event: MouseEvent): void {
      const target = event.target as Node;
      if (
        panelRef.current?.contains(target) === true ||
        buttonRef.current?.contains(target) === true
      ) {
        return;
      }
      close(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [expanded, close]);

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close(true);
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (visibleRepos.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % visibleRepos.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? visibleRepos.length - 1 : current - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = visibleRepos[activeIndex];
      if (target !== undefined) {
        togglePin(target.nameWithOwner);
      }
    }
  }

  function selectAllOwners(): void {
    for (const { owner } of availableOwners) {
      if (!query.facets.owners.includes(owner)) {
        toggleOwner(owner);
      }
    }
  }

  function clearOwners(): void {
    for (const owner of query.facets.owners) {
      toggleOwner(owner);
    }
  }

  // Invert the pin selection across the currently visible (matching) repos:
  // keep the visible repos that are NOT currently selected.
  function invertVisible(): void {
    const names = visibleRepos
      .map((r) => r.nameWithOwner)
      .filter((name) => !derivedSelected.has(name));
    setRepoSelection({ mode: 'include', names });
  }

  const activeOptionId =
    activeIndex >= 0 && activeIndex < visibleRepos.length
      ? `${optionBaseId}-${activeIndex}`
      : undefined;

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={`Filter repositories. Current scope: ${summary}`}
        onClick={() => (expanded ? close(false) : setExpanded(true))}
        className={DISCLOSURE_BUTTON}
      >
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        <span>{summary}</span>
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`transition-transform motion-reduce:transition-none ${
            expanded ? 'rotate-180' : ''
          }`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-label="Repository filters"
          onKeyDown={handlePanelKeyDown}
          className="absolute left-0 top-full z-20 mt-1 flex max-h-[28rem] w-80 flex-col gap-3 overflow-auto rounded-md border border-border-strong bg-surface-overlay p-3 shadow-lg transition motion-reduce:transition-none"
        >
          <div
            data-testid="repo-filter-live"
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
          >
            {announcement}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={`${panelId}-search`} className="sr-only">
              Search repositories
            </label>
            <input
              ref={searchRef}
              id={`${panelId}-search`}
              type="text"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeOptionId}
              value={query.text}
              placeholder="Search repositories…"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              className={`w-full rounded border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-text placeholder:text-text-muted ${FOCUS_RING}`}
            />
            <ul
              id={listId}
              role="listbox"
              aria-label="Matching repositories"
              className="flex max-h-40 flex-col overflow-auto rounded border border-border-strong"
            >
              {visibleRepos.length === 0 ? (
                <li
                  role="option"
                  aria-disabled="true"
                  aria-selected={false}
                  className="px-2 py-1.5 text-sm text-text-muted"
                >
                  No repositories match
                </li>
              ) : (
                visibleRepos.map((r, index) => {
                  const name = r.nameWithOwner;
                  const selected = derivedSelected.has(name);
                  return (
                    <li
                      key={name}
                      id={`${optionBaseId}-${index}`}
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        setActiveIndex(index);
                        togglePin(name);
                      }}
                      className={`flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm text-text hover:bg-surface-raised ${
                        index === activeIndex ? 'bg-surface-raised' : ''
                      }`}
                    >
                      <span aria-hidden="true" className="w-3.5 text-center">
                        {selected ? '✓' : ''}
                      </span>
                      {name}
                    </li>
                  );
                })
              )}
            </ul>
          </div>

          {isActive && derivedSelected.size === 0 && (
            <div
              data-testid="zero-result-state"
              role="status"
              className="flex flex-col items-center gap-2 rounded border border-border-strong bg-surface px-3 py-4 text-center"
            >
              <p className="text-sm text-text-muted">No repositories match these filters.</p>
              <button
                type="button"
                onClick={clearAll}
                className={`rounded bg-surface-raised px-2.5 py-1 text-xs font-medium text-text hover:bg-surface-raised-hover ${FOCUS_RING}`}
              >
                Clear filters
              </button>
            </div>
          )}

          {recentFilters.length > 0 && (
            <div role="group" aria-label="Recent filters" className="flex flex-col gap-1.5">
              <p className="px-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Recent
              </p>
              <div className="flex flex-wrap gap-1.5">
                {recentFilters.map((recentQuery, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => applyQuery(recentQuery)}
                    className="rounded-full border border-border-strong bg-surface px-2.5 py-1 text-xs text-text hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    {summarizeQuery(recentQuery)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {chips.length > 0 && (
            <div role="group" aria-label="Active filters" className="flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex items-center gap-1 rounded-full border border-border-strong bg-surface-raised px-2 py-0.5 text-xs text-text"
                >
                  <span>{chip.label}</span>
                  <button
                    type="button"
                    onClick={chip.remove}
                    aria-label={`Remove ${chip.label} filter`}
                    className={`rounded p-0.5 text-text-muted hover:text-text ${FOCUS_RING}`}
                  >
                    <span aria-hidden="true">✕</span>
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 border-y border-border-strong py-2">
            <button type="button" onClick={clearAll} className={BULK_BUTTON}>
              Clear all
            </button>
            <button type="button" onClick={selectAllOwners} className={BULK_BUTTON}>
              Select all owners
            </button>
            <button type="button" onClick={clearOwners} className={BULK_BUTTON}>
              No owners
            </button>
            <button type="button" onClick={invertVisible} className={BULK_BUTTON}>
              Invert visible
            </button>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            <div role="group" aria-label="Owner" className="col-span-2 flex flex-col gap-1">
              <p className="px-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Owner
              </p>
              {availableOwners.map(({ owner, count }) => (
                <label key={owner} className={CHECKBOX_LABEL}>
                  <input
                    type="checkbox"
                    checked={query.facets.owners.includes(owner)}
                    onChange={() => toggleOwner(owner)}
                    className={CHECKBOX}
                  />
                  {`${owner} (${count})`}
                </label>
              ))}
            </div>

            <FacetGroup
              label="Health"
              options={HEALTH_OPTIONS}
              selected={query.facets.health}
              onToggle={toggleHealth}
            />
            <FacetGroup
              label="CI"
              options={CI_OPTIONS}
              selected={query.facets.ci}
              onToggle={toggleCi}
            />
            <FacetGroup
              label="Security grade"
              options={GRADE_OPTIONS}
              selected={query.facets.security.grades}
              onToggle={toggleSecurityGrade}
            />
            <FacetGroup
              label="Security severity"
              options={SEVERITY_OPTIONS}
              selected={query.facets.security.severities}
              onToggle={toggleSecuritySeverity}
            />
            <FacetGroup
              label="Pull requests"
              options={PR_OPTIONS}
              selected={query.facets.pullRequests}
              onToggle={togglePullRequests}
            />
            <div role="group" aria-label="Reviews" className="flex flex-col gap-1">
              <p className="px-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Reviews
              </p>
              <label className={CHECKBOX_LABEL}>
                <input
                  type="checkbox"
                  checked={query.facets.reviews.includes('awaiting-me')}
                  onChange={() => toggleReviewsAwaitingMe()}
                  className={CHECKBOX}
                />
                Awaiting my review
              </label>
            </div>
            <FacetGroup
              label="Issues"
              options={ISSUE_OPTIONS}
              selected={query.facets.issues}
              onToggle={toggleIssues}
            />
            <FacetGroup
              label="Stale"
              options={STALE_OPTIONS}
              selected={query.facets.stale}
              onToggle={toggleStale}
            />
            <FacetGroup
              label="Visibility"
              options={VISIBILITY_OPTIONS}
              selected={query.facets.visibility}
              onToggle={toggleVisibility}
            />
          </div>
        </div>
      )}
    </div>
  );
}
