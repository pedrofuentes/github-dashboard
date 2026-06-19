# Testing Strategy

> Extended testing context for AI agents. Referenced from AGENTS.md.
> **The TDD mandate (tests before implementation) is enforced in AGENTS.md and verified by Sentinel.**
> This document covers the details of HOW to test.

---

## Test Types

| Type | Purpose | Location | Runner |
|------|---------|----------|--------|
| Unit | Core logic, pure functions, isolated components | `tests/unit/` or `*.test.ts` | Vitest |
| Integration | Cross-component interactions, API calls, DOM manipulation | `tests/integration/` | Vitest |
| E2E | Critical user flows end-to-end | `tests/e2e/` | Playwright |

## Coverage Requirements

- **New code**: 80% diff coverage required (lines added/modified in the PR)
- **Project-wide coverage**: must never decrease from the previous merge baseline
- **Critical paths**: 100% coverage required (auth, payments, data mutations)
- **Run coverage**: `npm test --coverage`
- **Sentinel verifies coverage thresholds on every PR**

## Test-Only PRs

PRs that only add tests to existing (untested) code use commit type `test(scope)` and are exempt from test-first choreography ordering (there is no `feat`/`fix` to follow). Sentinel verifies the tests are meaningful and pass.

## Testing Patterns

### Mocking
Mock the GitHub API client at the module boundary with Vitest (`vi.mock` / `vi.spyOn`) for unit tests; use Mock Service Worker (MSW) to intercept `api.github.com` requests in integration tests. Inject the client/`fetch` into hooks and components so tests can supply test doubles. Never call the live GitHub API in tests.

```typescript
// Example: How to mock in this project
import { vi } from 'vitest';
import * as github from '../src/api/github';

// Stub the GitHub API client so no real network call is made
vi.spyOn(github, 'fetchRepoHealth').mockResolvedValue({
  failingChecks: 0,
  openPullRequests: 3,
  staleIssues: 1,
});
```

### Test Naming Convention
```
describe('RepoHealthCard', () => {
  it('should show a failing-checks badge when a workflow run is failing', () => {
    // Arrange → Act → Assert
  });
});
```

### What Must Be Tested
- All public API functions
- Error paths and edge cases (not just happy paths)
- State transitions
- Input validation and boundary conditions

### What Should NOT Be Tested
- Framework internals
- Third-party library behavior
- Implementation details (test behavior, not structure)

## CI Integration

- Tests run automatically on every PR via GitHub Actions
- All tests must pass before Sentinel review begins
- Flaky tests must be fixed immediately, not skipped
