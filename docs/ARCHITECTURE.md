# Architecture

> Extended architectural context for AI agents. Referenced from AGENTS.md.

---

## Project Structure

The project is a single-package, client-only Vite + React SPA (no backend, no monorepo). Initial target structure — expanded in later phases:

```
github-dashboard/
├── src/
│   ├── api/                     ← GitHub REST + GraphQL client (Zod schemas, fetchWithRetry, ETag caching)
│   ├── components/              ← Functional React components (fleet grid, repo cards, health badges)
│   ├── hooks/                   ← Data-fetching, caching & polling hooks
│   ├── lib/                     ← Pure helpers (security grading, staleness, rate-limit budgeting)
│   ├── types/                   ← Shared TypeScript types
│   ├── App.tsx
│   └── main.tsx                 ← Vite entry point
├── tests/                       ← Vitest unit/integration + Playwright e2e
├── public/                      ← Static assets (bundled locally; no third-party CDNs)
├── docs/                        ← Associated documentation
├── AGENTS.md                    ← Agent instructions (MUST rules)
├── ROADMAP.md                   ← Project phases and plan
├── index.html                   ← Vite HTML entry
├── LICENSE
├── README.md
├── package.json
└── vite.config.ts
```

## Key Technical Decisions

Rationale behind major technical choices (expanded as the project evolves):

| Decision | Choice | Rationale |
|----------|--------|-----------|
| App architecture | Client-only SPA, no backend | Privacy: token + data never leave the browser; zero-install, hostable on GitHub Pages |
| Build & framework | Vite + React + TypeScript | Fast dev/build; typed, component-based UI |
| API response validation | Zod schemas at the boundary | Catch GitHub API drift; type-safe parsing |
| Rate-limit strategy | Conditional requests (ETag) + batched GraphQL | Respect the 5,000 req/hr limit; degrade gracefully |

## Module Boundaries

How the `src/` modules relate to each other:

- `lib/` — Pure functions (grading, staleness, rate-limit budgeting); no React, no network
- `api/` — GitHub REST + GraphQL client; depends on `types/`; the only module that performs network I/O
- `hooks/` — Data fetching, caching & polling; depend on `api/` and `lib/`
- `components/` — Presentational + container React components; depend on `hooks/`, `lib/`, and `types/`

## Data Flow

The user's PAT (or device-flow token) is stored in the browser only. The `api/` client issues conditional (ETag) and batched GraphQL requests to GitHub-owned origins; responses are validated by Zod, cached, and surfaced through `hooks/` to `components/` for rendering. No user code or data leaves the browser except for calls to GitHub-owned origins.

## Key Files

Files agents should know about for orientation (created in later phases):

| File | Purpose |
|------|---------|
| `src/api/github.ts` | GitHub REST/GraphQL client — Zod schemas, `fetchWithRetry`, ETag caching, rate-limit handling |
| `src/main.tsx` | Vite + React entry point |
| `vite.config.ts` | Build config, base path, and SPA fallback for GitHub Pages |
