import type { ReactElement, ReactNode } from 'react';

/** SVG children for each known status (36×36 viewBox, centred at 18,18). */
const ICONS: Record<string, ReactNode> = {
  success: (
    <polyline
      points="8,19 15,26 28,12"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  failure: (
    <>
      <line
        x1="10"
        y1="10"
        x2="26"
        y2="26"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <line
        x1="26"
        y1="10"
        x2="10"
        y2="26"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </>
  ),
  in_progress: (
    <>
      <path
        d="M18,6 A12,12 0 1,1 6,18"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <polygon points="6,12 6,20 11,16" fill="currentColor" />
    </>
  ),
  cancelled: (
    <>
      <circle cx="18" cy="18" r="11" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <line
        x1="10"
        y1="26"
        x2="26"
        y2="10"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </>
  ),
  queued: (
    <>
      <circle cx="18" cy="18" r="11" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <line
        x1="18"
        y1="11"
        x2="18"
        y2="18"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1="18"
        y1="18"
        x2="24"
        y2="18"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </>
  ),
  pending: (
    <>
      <circle cx="8" cy="18" r="3" fill="currentColor" />
      <circle cx="18" cy="18" r="3" fill="currentColor" />
      <circle cx="28" cy="18" r="3" fill="currentColor" />
    </>
  ),
  waiting: (
    <>
      <circle cx="18" cy="18" r="11" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <line
        x1="18"
        y1="11"
        x2="18"
        y2="18"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1="18"
        y1="18"
        x2="24"
        y2="18"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </>
  ),
  skipped: (
    <>
      <line
        x1="8"
        y1="18"
        x2="28"
        y2="18"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <polyline
        points="20,10 28,18 20,26"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  timed_out: (
    <>
      <circle cx="18" cy="18" r="11" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <line
        x1="14"
        y1="14"
        x2="22"
        y2="22"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1="22"
        y1="14"
        x2="14"
        y2="22"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </>
  ),
  action_required: (
    <>
      <polygon
        points="18,6 32,30 4,30"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <line
        x1="18"
        y1="15"
        x2="18"
        y2="22"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="18" cy="26" r="1.5" fill="currentColor" />
    </>
  ),
  neutral: (
    <line
      x1="8"
      y1="18"
      x2="28"
      y2="18"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
  ),
  stale: (
    <line
      x1="8"
      y1="18"
      x2="28"
      y2="18"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
  ),
  requested: (
    <>
      <circle cx="18" cy="18" r="11" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="18" cy="18" r="4" fill="currentColor" />
    </>
  ),
  deploying: <polygon points="18,6 28,28 18,22 8,28" fill="currentColor" />,
};

const DEFAULT_ICON: ReactNode = (
  <>
    <circle cx="18" cy="18" r="11" fill="none" stroke="currentColor" strokeWidth="2.5" />
    <text
      x="18"
      y="24"
      textAnchor="middle"
      fill="currentColor"
      fontSize="18"
      fontWeight="bold"
      fontFamily="Arial"
    >
      ?
    </text>
  </>
);

export function BoardStatusIcon({
  status,
  size = 40,
}: {
  status: string;
  size?: number;
}): ReactElement {
  const icon = ICONS[status] ?? DEFAULT_ICON;
  return (
    <svg viewBox="0 0 36 36" width={size} height={size} aria-hidden="true" data-status={status}>
      {icon}
    </svg>
  );
}
