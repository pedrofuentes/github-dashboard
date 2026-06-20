<div align="center">

# github-dashboard

**Fleet health for all your GitHub repositories — at a glance.**

### [▶ Use it now → pedrofuent.es/github-dashboard](https://pedrofuent.es/github-dashboard/)

[![CI](https://github.com/pedrofuentes/github-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/pedrofuentes/github-dashboard/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/pedrofuentes/github-dashboard/actions/workflows/deploy.yml/badge.svg)](https://github.com/pedrofuentes/github-dashboard/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<a href="https://pedrofuent.es/github-dashboard/">
  <img src="docs/screenshots/fleet-grid.png" alt="Fleet overview grid: one row per repository with columns for CI, security grade, review requests, open pull requests, open issues and stale items across eight repositories" width="920">
</a>

<sub><i>The screenshots in this README are rendered against <b>mocked</b> GitHub data — none of these repositories are real.</i></sub>

</div>

---

If you maintain a lot of GitHub repositories, the things that need your attention are scattered across dozens of tabs: a red workflow here, a security alert there, a pull request waiting on _your_ review somewhere else. **github-dashboard** pulls all of it onto one screen so you can see — across your whole fleet — **what's broken, what's waiting on you, and what's risky**, without clicking through repo after repo.

It's a **private, zero-install, client-only** single-page app. Your token and your data stay in your browser; the only thing it ever talks to is GitHub.

- **Who it's for:** maintainers who juggle many repositories and want one place to triage them.
- **What it costs:** nothing — it's a static web app served from GitHub Pages.

## What it does

The home screen is a **fleet overview grid** — one row per repository — that brings six health signals together in one place:

| Signal               | What it tells you                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------- |
| **CI / Actions**     | Latest workflow-run status per repo — failing and in-progress runs flagged first.            |
| **Security**         | Dependabot + code-scanning alerts rolled into an **A–F grade** with a severity breakdown.    |
| **Reviews**          | Pull requests awaiting **_your_** review (`review-requested:@me`).                            |
| **Pull requests**    | Open-PR count, with pull requests from **new outside contributors** highlighted.             |
| **Issues**           | Open-issue count, with a warning once the backlog crosses the triage threshold.              |
| **Stale**            | Open PRs/issues with no activity past the staleness threshold.                               |

Click any row to open the **drill-down drawer** — the full signal breakdown for a single repository:

<div align="center">
  <img src="docs/screenshots/drill-down-drawer.png" alt="Drill-down drawer for acme/payments-service showing CI conclusion, security grade F with critical/high/medium counts, review requests, open pull requests with outside-contributor highlight, open issues over the triage threshold, and stale items" width="920">
</div>

Together that's the seven at-a-glance signals from the [mission brief](MISSION.md) — the fleet overview grid plus its six per-repo columns — and the row drill-down.

## Dashboard view

Prefer a spatial layout over a table? A **Grid / Dashboard** toggle (top-left of the overview, persisted in your browser under `fleet:view` and defaulting to the table grid) switches the fleet between the row-per-repo grid and an **at-a-glance Dashboard view**.

<!-- TODO: dashboard screenshot — capture via the authenticated-fleet Playwright harness once a reusable fixture exists. -->

The Dashboard view is built for triage at a glance:

- **A pinned fleet summary** anchors the top: total repos and the split into **need attention** (failing CI, a D–F security grade, or an over-threshold issue backlog), **warning** (a C security grade, a pending review request, or stale items), and **healthy** — plus the non-zero per-signal rollups (failing CI, security risk, awaiting your review, stale). It's always there: not draggable, resizable, or removable.
- **Glanceable tiles** — one card per (repo, signal) — reuse the same icon + colour + text encoding as the grid (never colour alone), with per-status states (loading / error / unknown / ready) and a status accent. Activate any tile (click or Enter/Space) to open the same drill-down drawer as the grid.
- **Edit mode** — a **Customize layout** toggle (shown only in the Dashboard view) lets you rearrange and size tiles by **pointer drag + resize**, or with the keyboard via each tile's **Move / Resize** controls. Tile navigation follows the WAI-ARIA grid pattern (a single roving tab stop; ←/→/↑/↓ move focus between tiles), every keyboard change is announced via an `aria-live` region, and motion is suppressed under `prefers-reduced-motion` — WCAG 2.1 AA throughout.
- **Layout persistence** — your tile arrangement is saved to `localStorage` (debounced) and restored on the next visit, reconciled against the current fleet so added/removed repos are handled gracefully.

## Privacy & security

github-dashboard is **client-only**: there is no backend, and your data never touches a server anyone else controls.

- **Your token stays in your browser.** You paste a GitHub Personal Access Token once. By default it is kept **in memory only** (the _“Don't remember”_ option) and disappears when you close the tab. You can optionally choose **This session** (`sessionStorage`) or **This device** (`localStorage`); when persisted, it is stored under the key `github-dashboard.pat`. _(See [`src/lib/token-storage.ts`](src/lib/token-storage.ts) and [`src/hooks/AuthProvider.tsx`](src/hooks/AuthProvider.tsx).)_
- **GitHub origins only.** Every network request goes to a GitHub-owned origin — `api.github.com` for data, and `avatars.githubusercontent.com` / `raw.githubusercontent.com` for avatars. The fetch layer hard-refuses any non-GitHub origin. No telemetry, no analytics, no third parties.
- **Every response is validated.** GitHub API responses are parsed and checked with [Zod](https://zod.dev) before they ever reach the UI.
- **Read-only by design.** The token only needs read permissions (below); the app never writes to your repositories.

### Required token permissions

The app asks for a **fine-grained PAT** granting these **read-only** repository permissions:

- **Actions**
- **Code scanning alerts**
- **Contents**
- **Dependabot alerts**
- **Issues**
- **Metadata**
- **Pull requests**

Prefer a classic token? Grant the **`repo`** scope (it covers private repositories; `public_repo` alone limits the view to public repos).

<div align="center">
  <img src="docs/screenshots/token-entry.png" alt="Sign-in screen: a personal access token field, three persistence options (Don't remember / This session / This device), a Connect to GitHub button, and the list of seven read-only fine-grained permissions to grant" width="760">
</div>

## Quick start

1. **Open the app:** **[pedrofuent.es/github-dashboard](https://pedrofuent.es/github-dashboard/)**
2. **Create a token:** generate a [fine-grained PAT](https://github.com/settings/personal-access-tokens/new) with the [read-only permissions listed above](#required-token-permissions). _(A classic token with the `repo` scope also works.)_
3. **Paste it in** and choose whether to remember it — the default keeps it in memory only.
4. **Watch your fleet** populate with live signals, and click any repo for the drill-down.

No install, no sign-up, no backend.

## Run locally

Prerequisites: **Node.js 20+** and **npm**.

```bash
git clone https://github.com/pedrofuentes/github-dashboard.git
cd github-dashboard
npm ci
npm run dev   # start the Vite dev server, then open the printed localhost URL
```

### Scripts

| Script                  | What it does                                            |
| ----------------------- | ------------------------------------------------------ |
| `npm run dev`           | Start the Vite dev server.                             |
| `npm run build`         | Type-check, then build the production bundle to `dist/`. |
| `npm run preview`       | Serve the production build locally.                    |
| `npm test`              | Run unit/component tests (Vitest).                     |
| `npm run test:coverage` | Run tests with coverage (80% threshold).               |
| `npm run test:e2e`      | Run end-to-end tests (Playwright).                     |
| `npm run lint`          | ESLint (zero warnings) **and** a Prettier format check. |
| `npm run typecheck`     | Type-check with the TypeScript compiler only.          |
| `npm run typecheck:test` | Type-check the test files (`tsconfig.vitest.json`).   |
| `npm run format`        | Format the codebase with Prettier.                     |

## Tech stack

- **TypeScript 5.6** + **React 18**
- **Vite 5** for dev server and build
- **Tailwind CSS 3** for styling
- **Zod 3** for runtime validation of every API response
- **Vitest** + **Testing Library** (unit/component) and **Playwright** (end-to-end)
- **ESLint** (typescript-eslint) + **Prettier**

## Deployment

Hosted on **GitHub Pages** and deployed by the [Deploy to GitHub Pages](.github/workflows/deploy.yml) Actions workflow on every push to `main` (and via manual dispatch). The output is a static SPA with a `404.html` fallback for client-side routing, served under the Vite base path `/github-dashboard/`. Live at **[pedrofuent.es/github-dashboard](https://pedrofuent.es/github-dashboard/)**.

## Contributing

Contributions are welcome — please read **[CONTRIBUTING.md](CONTRIBUTING.md)** for the development workflow, coding standards, and the test-and-review process.

## License

[MIT](LICENSE) © 2026 Pedro Fuentes ([@pedrofuentes](https://github.com/pedrofuentes))
