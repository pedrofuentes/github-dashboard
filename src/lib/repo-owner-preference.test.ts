import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Repo } from '../types/fleet';
import {
  formatRepoLabel,
  loadRepoOwnerPreference,
  saveRepoOwnerPreference,
} from './repo-owner-preference';

const REPO_OWNER_KEY = 'fleet:repo-owner';

const REPO: Repo = {
  nameWithOwner: 'octocat/hello-world',
  owner: 'octocat',
  name: 'hello-world',
  isPrivate: false,
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('loadRepoOwnerPreference', () => {
  it('defaults to "show" when nothing is stored', () => {
    expect(loadRepoOwnerPreference()).toBe('show');
  });

  it('reads a stored "show" preference', () => {
    localStorage.setItem(REPO_OWNER_KEY, 'show');
    expect(loadRepoOwnerPreference()).toBe('show');
  });

  it('reads a stored "hide" preference', () => {
    localStorage.setItem(REPO_OWNER_KEY, 'hide');
    expect(loadRepoOwnerPreference()).toBe('hide');
  });

  it('defaults to "show" for a corrupt / unrecognised value', () => {
    localStorage.setItem(REPO_OWNER_KEY, 'visible');
    expect(loadRepoOwnerPreference()).toBe('show');
  });

  it('defaults to "show" when the key is missing after removal', () => {
    localStorage.setItem(REPO_OWNER_KEY, 'hide');
    localStorage.removeItem(REPO_OWNER_KEY);
    expect(loadRepoOwnerPreference()).toBe('show');
  });

  it('defaults to "show" when localStorage.getItem throws (assert via value)', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadRepoOwnerPreference()).toBe('show');
  });
});

describe('saveRepoOwnerPreference', () => {
  it('persists the preference', () => {
    saveRepoOwnerPreference('hide');
    expect(localStorage.getItem(REPO_OWNER_KEY)).toBe('hide');
  });

  it('round-trips through loadRepoOwnerPreference', () => {
    saveRepoOwnerPreference('hide');
    expect(loadRepoOwnerPreference()).toBe('hide');
  });

  it('persists and round-trips the "show" preference', () => {
    saveRepoOwnerPreference('show');
    expect(localStorage.getItem(REPO_OWNER_KEY)).toBe('show');
    expect(loadRepoOwnerPreference()).toBe('show');
  });

  it('swallows localStorage.setItem throwing', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => saveRepoOwnerPreference('hide')).not.toThrow();
  });
});

describe('formatRepoLabel', () => {
  it('returns the full owner/name label when display is "show"', () => {
    expect(formatRepoLabel(REPO, 'show')).toBe('octocat/hello-world');
  });

  it('returns the bare repo name when display is "hide"', () => {
    expect(formatRepoLabel(REPO, 'hide')).toBe('hello-world');
  });
});
