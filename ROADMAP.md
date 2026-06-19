# Roadmap — github-dashboard

> Project phases, milestones, and implementation plan.

## Current Phase

Phase 0 (harness bootstrap) is complete. Next up is **Phase 1 — Foundation & GitHub API client**.

## Phases

### Phase 1: Foundation & GitHub API client
- Scaffold the Vite + React + TypeScript + Tailwind app with CI (lint, typecheck, Vitest, Sentinel Method B) and branch protection
- Port/adapt the GitHub REST + GraphQL client (Zod schemas, `fetchWithRetry`, ETag caching, rate-limit handling) from `stream-deck-github-utilities`

### Phase 2: Fleet overview MVP
- Fleet overview grid surfacing health signals: failing Actions, open & new-contributor PRs, security alerts, review-requested queue, issues, and stale detection
- Fine-grained read-only PAT auth stored in-browser, plus the Playwright privacy test asserting GitHub-owned origins only

### Phase 3: Polish, deploy & device flow
- GitHub Pages deploy pipeline (Vite base path + SPA fallback) and a README with screenshots/GIF
- OAuth device-flow auth implemented client-side — or explicitly deferred with a written rationale + cofounder sign-off — plus rate-limit hardening near the 5,000 req/hr limit

## Key Milestones

| Milestone | Phase | Status |
|-----------|-------|--------|
| GitHub API client (REST + GraphQL, Zod, ETag caching) | Phase 1 | pending |
| Live fleet-overview MVP with PAT auth | Phase 2 | pending |
| Public GitHub Pages deploy + privacy test green | Phase 3 | pending |
