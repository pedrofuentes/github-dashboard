# Contributing to github-dashboard

**github-dashboard** is a private, client-only React + Vite + TypeScript SPA — a GitHub "fleet health" dashboard. Your PAT stays in the browser and is sent exclusively to `api.github.com`; nothing else ever touches a server.

> **Source of truth**: [`AGENTS.md`](./AGENTS.md) governs all workflow rules. This guide is a human-readable summary — when in doubt, defer to `AGENTS.md`.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20 (matches CI) |
| npm | bundled with Node |

```bash
npm ci   # install exact locked deps
```

---

## Local Development

```bash
npm run dev           # start Vite dev server (http://localhost:5173)
npm run build         # typecheck + production build
npm run preview       # preview production build locally
```

---

## Quality Checks

Run these before every push (CI enforces them all):

```bash
npm run lint          # ESLint (zero warnings) + Prettier format check
npm run format        # auto-fix formatting with Prettier
npm run typecheck     # TypeScript type-check (no emit)
npm test              # Vitest unit/integration suite
npm run test:coverage # same + coverage report (≥ 80% required)
npm run test:e2e      # Playwright end-to-end tests
```

Target a specific file for faster feedback:

```bash
npm test -- src/path/to/file.test.ts
npm run lint -- src/path/to/file.ts
```

---

## Workflow & Conventions

### Branch Naming

```
<type>/<short-name>
# e.g. feat/security-alerts, fix/rate-limit, docs/contributing
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `style`, `perf`

### Worktree Isolation

Every task runs in its own git worktree — **never commit directly to `main`**:

```bash
git fetch origin main
git worktree add .worktrees/<name> -b <type>/<name> main
cd .worktrees/<name>
```

After the PR merges, clean up:

```bash
cd <repo-root>
git worktree remove .worktrees/<name>
git branch -D <type>/<name>
```

### Test-Driven Development (TDD) — Required

TDD is non-negotiable and mechanically verified on every PR:

1. **RED** — write a failing test, commit as `test(scope): add failing tests`. Run the suite and confirm it fails.
2. **GREEN** — write minimal implementation, commit as `feat|fix(scope): implement`. Run the suite and confirm it passes.
3. **REFACTOR** — clean up with the suite staying green.

`test(scope)` commit **must precede** the `feat|fix(scope)` commit in git history. Sentinel rejects any PR where implementation appears before its test.

`docs`, `chore`, `ci`, `style`, and behavior-preserving `refactor` commits are exempt from TDD ordering — but the existing suite must still pass.

### Conventional Commits

```
type(scope): short description

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

### Sentinel Quality Gate

Every PR to `main` must pass **Sentinel** review before merging — see [`docs/SENTINEL.md`](./docs/SENTINEL.md) for the full spec.

- Sentinel verifies TDD ordering, test passage, coverage, lint, and security rules.
- CI must be green before Sentinel is invoked.
- Coverage must not decrease below **80%**.

---

## Security & Privacy

- **Never commit a PAT or any secret** — not in code, not in comments, not in test fixtures.
- All network calls **must target `https://api.github.com`** (or `github.com/login/*`, `*.githubusercontent.com`). No proxies, no third-party endpoints.
- Every GitHub API response **must be validated with Zod** before use.
- Any URL obtained from API responses **must be origin-validated** before fetching or rendering.
- The user's PAT must never leave the browser or appear in logs/analytics.

---

## Reporting Issues

Open a GitHub issue with a clear title and reproduction steps. For security issues, follow responsible disclosure — contact the maintainer privately.

---

## Pull Request Checklist

Before opening a PR, verify:

- [ ] `git log --oneline main..HEAD` shows `test(scope)` before `feat|fix(scope)`
- [ ] `npm test` — full suite green
- [ ] `npm run test:coverage` — coverage ≥ 80%
- [ ] `npm run lint` — zero warnings
- [ ] `npm run typecheck` — no errors
- [ ] Commit messages follow Conventional Commits format
- [ ] No secrets, PATs, or hardcoded credentials in any changed file
- [ ] Sentinel conditions resolved (see [`docs/SENTINEL.md`](./docs/SENTINEL.md))

---

## License

This project is private. See [`LICENSE`](./LICENSE) for terms.
