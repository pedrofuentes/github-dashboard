# Learnings — github-dashboard

> **This file is written by AI agents.** When you discover something about this project
> that isn't documented elsewhere, add it here. Do NOT write to AGENTS.md.
>
> Periodically, a human or agent should review this file and promote stable learnings
> into the appropriate companion doc (ARCHITECTURE.md, TESTING-STRATEGY.md, etc.).

## Format

```markdown
### [YYYY-MM-DD] Short description
**Context**: What were you doing when you discovered this?
**Learning**: What did you learn?
**Impact**: How should this affect future work?
```

## Learnings

<!-- Add new learnings below this line, most recent first -->

### [2026-06-20] Assert debounced side-effects via the flush/unmount path, not fake-timer advance inside React `act`
**Context**: PR #123 (M10 T3) opened green locally but its CI `quality` check failed: the #116 debounced-persist "coalesce" tests (`useDashboardLayout.test.ts`, `DashboardView.onLayoutChange.test.tsx`) asserted exactly one `localStorage` write, getting `expected [] to have a length of 1 but got 0`. A first fix tried `await act(async () => { await vi.advanceTimersByTimeAsync(300); })` to flush the debounced `setTimeout`; that passed on macOS (even under CI-like `--pool=threads` settings over the full suite) but **still flaked on the Linux CI runner**. The fragile axis is flushing a debounce `setTimeout` by advancing fake timers inside React 18's `act` — it is not reliable across platforms/runners.
**Learning**: To assert a debounced side-effect deterministically, drive it through a **synchronous flush path** instead of advancing time. `useDashboardLayout` already flushes on unmount (`useEffect(() => () => persist.flush(), [persist])`), so: fire the burst inside one `act`, assert no premature write, then `unmount()` — the effect cleanup runs `persist.flush()`, producing exactly one synchronous write with the final state. This removes fake timers from the React-level tests entirely and is deterministic on every platform. Keep trailing-edge **timer-expiry** coverage (fires ~300 ms after the last call) in the pure-util `src/lib/debounce.test.ts`, where `vi.advanceTimersByTime` + no React/`act` is deterministic. Setup precondition state (e.g. for `reset`) by seeding `localStorage` directly rather than advancing a debounce. This is a test-determinism issue, not a product bug — the debounce semantics (300 ms, coalesce-to-one, flush-on-unmount) were correct.
**Impact**: Prefer asserting debounced/async side-effects via a deterministic flush or unmount path over flushing a `setTimeout` through fake-timer advance inside React `act` (the latter can pass on one OS and flake on the CI runner). "Passes locally" — even under CI-like flags — is necessary but NOT sufficient; the real gate is the CI run on the pushed SHA.
