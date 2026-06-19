interface StubCellProps {
  /** Screen-reader text describing the (not-yet-available) signal. */
  srLabel: string;
}

/**
 * Neutral placeholder rendered by every signal stub column until features
 * #12-18 replace them. Shows a visible em dash (decorative, `aria-hidden`)
 * paired with screen-reader text, so the "no data" state never relies on
 * colour or a bare glyph alone (WCAG 2.1 AA).
 */
export function StubCell({ srLabel }: StubCellProps) {
  return (
    <span className="inline-flex items-center justify-center text-slate-500">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{srLabel}</span>
    </span>
  );
}
