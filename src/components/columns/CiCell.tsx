import type { CiSignalSlice } from '../../types/fleet';

interface CiCellProps {
  /** The repo's CI slice, or `undefined` when no data has been resolved yet. */
  slice?: CiSignalSlice;
}

type Conclusion = NonNullable<CiSignalSlice['conclusion']>;

interface Presentation {
  /** Decorative glyph (paired with text, never the sole signal). */
  icon: string;
  /** Compact visible label. */
  text: string;
  /** Concise accessible description. */
  label: string;
  /** Colour hint — an enhancement layered on top of the icon + text. */
  className: string;
}

const PRESENTATION: Record<Conclusion, Presentation> = {
  success: { icon: '✓', text: 'Passing', label: 'CI passing', className: 'text-emerald-400' },
  failure: { icon: '✗', text: 'Failing', label: 'CI failing', className: 'text-red-400' },
  in_progress: { icon: '⟳', text: 'Running', label: 'CI running', className: 'text-amber-400' },
  queued: { icon: '⟳', text: 'Queued', label: 'CI queued', className: 'text-amber-400' },
  none: { icon: '–', text: 'No runs', label: 'CI no runs', className: 'text-slate-500' },
};

/** True only for `https://github.com` or a `*.github.com` subdomain. */
function isGitHubUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:') {
      return false;
    }
    return hostname === 'github.com' || hostname.endsWith('.github.com');
  } catch {
    return false;
  }
}

/** Neutral placeholder: a decorative dash plus screen-reader-only text. */
function Neutral({ srLabel, title }: { srLabel: string; title?: string }) {
  return (
    <span className="inline-flex items-center justify-center text-slate-500" title={title}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{srLabel}</span>
    </span>
  );
}

/**
 * CI status cell. Encodes state with an icon **and** text/`aria-label` (never
 * colour alone), and—when the latest run links to a GitHub-owned URL—wraps the
 * status in a deep link to that run.
 */
export function CiCell({ slice }: CiCellProps) {
  if (!slice || slice.status === 'unknown') {
    return <Neutral srLabel="CI status unknown" />;
  }

  if (slice.status === 'loading') {
    return (
      <span className="inline-flex items-center justify-center">
        <span aria-hidden="true" className="h-3 w-12 animate-pulse rounded bg-slate-700" />
        <span className="sr-only">Loading CI status</span>
      </span>
    );
  }

  if (slice.status === 'error') {
    return <Neutral srLabel="Couldn't load CI status" title="Couldn't load CI status" />;
  }

  const { icon, text, label, className } = PRESENTATION[slice.conclusion ?? 'none'];

  const status = (
    <span
      aria-label={label}
      className={`inline-flex items-center justify-center gap-1 text-xs font-medium ${className}`}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{text}</span>
    </span>
  );

  if (slice.latestRunUrl && isGitHubUrl(slice.latestRunUrl)) {
    return (
      <a
        href={slice.latestRunUrl}
        target="_blank"
        rel="noreferrer noopener"
        title="View latest CI run"
        className="inline-flex rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        {status}
      </a>
    );
  }

  return status;
}
