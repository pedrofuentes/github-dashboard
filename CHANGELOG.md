# Changelog — github-dashboard

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Bounded in-memory LRU for the ETag/response cache (size cap with oldest-entry
  eviction) so long sessions can't grow the cache unbounded (#47).
- Live rate-limit awareness: a small in-memory store records the latest
  `X-RateLimit-Remaining`/`X-RateLimit-Reset` and `Retry-After` from responses,
  exposes the current status, and defensively defers non-essential conditional
  fetches while the primary budget is critically low or a secondary-rate-limit
  pause is in effect (#47).
- Visibility-driven revalidation: returning to a tab triggers a throttled,
  conditional (`If-None-Match`) refresh of per-repo signals — refreshing
  background-stale data with mostly-free `304`s (#47).

### Changed

### Fixed

- Abort-aware retry backoff: cancelling a request during the retry backoff now
  aborts promptly instead of waiting out the full delay, and never issues an
  extra network request; genuine timeouts remain retryable (#70).

### Removed
