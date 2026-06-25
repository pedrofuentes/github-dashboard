# T-dv3 — Per-tile hide/remove for BoardView (the Deck)

Single PR. Base = main `be63a94`. Worktree `feature/board-view-edit`.

## Increment (1 PR)

1. **RED** `test(board): cover hiddenKeys filter + edit-mode remove overlay`
   - hiddenKeys omits exactly the hidden (repo×signal) keys; count = repos×6 − hidden.
   - repoFilter + hiddenKeys compose.
   - status line announces visible **tile** count when tiles are hidden (plural + singular).
   - all-tiles-hidden empty state (distinct from no-repos / filtered).
   - editing=false ⇒ no × overlay (unchanged render).
   - editing=true ⇒ accessible × button per VISIBLE key, `aria-label="Remove {SIGNAL_LABELS[signal]} tile for {repo.nameWithOwner}"`, calls `onToggleKey(repo, signal)`.
   - × is a sibling overlay, NOT nested in the key button.
   - hidden keys get no × overlay.

2. **GREEN** `feat(board): per-tile hide + edit-mode remove overlay`
   - New props: `hiddenKeys?: Set<string>` (default empty ⇒ all visible), `editing?: boolean` (default false), `onToggleKey?: (repo, signal) => void`.
   - Replace local `BOARD_SIGNALS` with `DECK_SIGNALS` (single source from deck-visibility lib).
   - Filter hidden keys via `isHidden(hiddenKeys, repo.nameWithOwner, signal)`.
   - Edit mode: relative wrapper + absolute × `<button>` overlay (focus-token ring), `SIGNAL_LABELS` from grid-keyboard.
   - All-hidden empty state with Customize hint.
   - Status: append visible tile count when tiles are hidden.
   - Keep repoFilter, skeletons, error+retry (onRetry), a11y region. Token-only.

## Verify
format · lint (0) · typecheck + typecheck:test · test · coverage ≥80% · build.
`git log`: test(board) before feat(board). Push, open PR, STOP, report.
