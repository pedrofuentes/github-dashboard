/**
 * FleetLoadingBanner — a progress indicator for the in-flight fleet signal
 * fetch (T-g1). Displays a spinner, a "Loading fleet data…" label, and a
 * ready/total counter (e.g. "42/50 repos"). It's rendered inline at the top
 * of the Fleet Matrix or Grid when the background refresh is active, so the
 * user sees continuous feedback without blocking the already-loaded repo list.
 *
 * Only visible when `loading` is true; self-hides otherwise (returns null).
 */
interface FleetLoadingBannerProps {
  loading: boolean;
  ready: number;
  total: number;
}

export function FleetLoadingBanner({ loading, ready, total }: FleetLoadingBannerProps) {
  if (!loading) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm text-text-muted shadow-sm"
    >
      <svg
        aria-hidden="true"
        className="h-4 w-4 animate-spin text-text-muted motion-reduce:animate-none"
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeWidth="3"
        />
        <path
          className="opacity-75"
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <span>
        Loading fleet data… {ready}/{total} repos
      </span>
    </div>
  );
}
