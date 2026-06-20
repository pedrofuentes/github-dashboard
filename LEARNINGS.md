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

### [2026-06-20] Fake timers + React 18 `act`: use `advanceTimersByTimeAsync` for debounced/async effects
**Context**: PR #123 (M10 T3) opened green locally but its CI `quality` check failed: the #116 debounced-persist "coalesce" tests (`useDashboardLayout.test.ts`, `DashboardView.onLayoutChange.test.tsx`) asserted exactly one `localStorage` write after `act(() => { vi.advanceTimersByTime(300); })`, getting `expected [] to have a length of 1 but got 0`. They passed on the implementer's machine but flaked under Vitest's parallel CI workers (#122).
**Learning**: Synchronously advancing fake timers (`vi.advanceTimersByTime`) inside a sync `act` does NOT reliably flush a debounced `setTimeout` callback (and any pending microtasks / React work it triggers) under React 18's scheduler — the timing is nondeterministic across machines and parallel workers. Use the async form inside an async act: `await act(async () => { await vi.advanceTimersByTimeAsync(MS); })`. Also balance and isolate fake-timer state per test (`vi.useFakeTimers()` in setup; `vi.clearAllTimers()` + `vi.useRealTimers()` in teardown/`finally`) so timer state never leaks across parallel workers. This is a test-determinism issue, not a product bug — the debounce semantics (300 ms, coalesce-to-one) were correct.
**Impact**: For any test exercising a debounced or otherwise async effect through `act`, prefer `await act(async () => await vi.advanceTimersByTimeAsync(...))` over sync `advanceTimersByTime`. "Passes locally once" is not sufficient evidence — verify determinism by running `npm run test:coverage` several times consecutively and with `--sequence.shuffle`.
