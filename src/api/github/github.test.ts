/**
 * Tests for GitHub token validation, repo parsing, and count formatting (src/utils/github.ts).
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect } from 'vitest';
import {
  isValidGitHubToken,
  maskToken,
  formatCount,
  isValidRepoIdentifier,
  parseRepoIdentifier,
} from './github';

// ---------------------------------------------------------------------------
// isValidGitHubToken
// ---------------------------------------------------------------------------
describe('isValidGitHubToken', () => {
  it('should accept a valid classic personal access token (ghp_)', () => {
    const token = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234';
    expect(isValidGitHubToken(token)).toBe(true);
  });

  it('should accept a valid fine-grained personal access token (github_pat_)', () => {
    // 22 chars + _ + 59 chars
    const token = `github_pat_${'A'.repeat(22)}_${'B'.repeat(59)}`;
    expect(isValidGitHubToken(token)).toBe(true);
  });

  it('should reject an empty string', () => {
    expect(isValidGitHubToken('')).toBe(false);
  });

  it('should reject null / undefined / non-string values', () => {
    expect(isValidGitHubToken(null as unknown as string)).toBe(false);
    expect(isValidGitHubToken(undefined as unknown as string)).toBe(false);
    expect(isValidGitHubToken(123 as unknown as string)).toBe(false);
  });

  it('should reject a token with incorrect prefix', () => {
    expect(isValidGitHubToken('gho_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234')).toBe(false);
  });

  it('should reject a classic token with wrong length', () => {
    expect(isValidGitHubToken('ghp_tooshort')).toBe(false);
    expect(isValidGitHubToken('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef12345Extra')).toBe(false);
  });

  it('should reject tokens with special characters', () => {
    expect(isValidGitHubToken('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^1234')).toBe(false);
  });

  it('should handle tokens with leading/trailing whitespace via trimming', () => {
    const token = '  ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234  ';
    // The function trims, so this should still potentially match
    // Actually the trimmed version must match the regex exactly
    expect(isValidGitHubToken(token)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// maskToken
// ---------------------------------------------------------------------------
describe('maskToken', () => {
  it('should mask a standard token showing first 7 characters', () => {
    const token = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234';
    const masked = maskToken(token);
    expect(masked).toMatch(/^ghp_ABC\*+$/);
    expect(masked).not.toContain('DEFGH');
  });

  it("should return '****' for empty string", () => {
    expect(maskToken('')).toBe('****');
  });

  it("should return '****' for short strings (< 8 chars)", () => {
    expect(maskToken('abc')).toBe('****');
    expect(maskToken('1234567')).toBe('****');
  });

  it("should return '****' for null/undefined", () => {
    expect(maskToken(null as unknown as string)).toBe('****');
    expect(maskToken(undefined as unknown as string)).toBe('****');
  });

  it('should handle an 8-character string', () => {
    const result = maskToken('12345678');
    expect(result.startsWith('1234567')).toBe(true);
    expect(result).toBe('1234567****');
  });
});

// ---------------------------------------------------------------------------
// formatCount
// ---------------------------------------------------------------------------
describe('formatCount', () => {
  it('should return the number as-is when less than 1000', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1)).toBe('1');
    expect(formatCount(999)).toBe('999');
  });

  it("should format thousands with 'k' suffix", () => {
    expect(formatCount(1000)).toBe('1k');
    expect(formatCount(1500)).toBe('1.5k');
    expect(formatCount(12345)).toBe('12.3k');
    expect(formatCount(999999)).toBe('1000k');
  });

  it("should format millions with 'M' suffix", () => {
    expect(formatCount(1_000_000)).toBe('1M');
    expect(formatCount(1_234_567)).toBe('1.2M');
    expect(formatCount(50_500_000)).toBe('50.5M');
  });

  it("should format billions with 'B' suffix", () => {
    expect(formatCount(1_000_000_000)).toBe('1B');
    expect(formatCount(2_500_000_000)).toBe('2.5B');
  });

  it('should handle negative numbers', () => {
    expect(formatCount(-500)).toBe('-500');
    expect(formatCount(-1500)).toBe('-1.5k');
    expect(formatCount(-2_000_000)).toBe('-2M');
  });

  it("should return '0' for NaN, null, undefined", () => {
    expect(formatCount(NaN)).toBe('0');
    expect(formatCount(null as unknown as number)).toBe('0');
    expect(formatCount(undefined as unknown as number)).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// isValidRepoIdentifier
// ---------------------------------------------------------------------------
describe('isValidRepoIdentifier', () => {
  it('should accept valid owner/repo identifiers', () => {
    expect(isValidRepoIdentifier('octocat/Hello-World')).toBe(true);
    expect(isValidRepoIdentifier('pedrofuentes/stream-deck-github-utilities')).toBe(true);
    expect(isValidRepoIdentifier('a/b')).toBe(true);
  });

  it('should reject identifiers without a slash', () => {
    expect(isValidRepoIdentifier('octocatHelloWorld')).toBe(false);
  });

  it('should reject identifiers with multiple slashes', () => {
    expect(isValidRepoIdentifier('owner/repo/extra')).toBe(false);
  });

  it('should reject empty owner or repo', () => {
    expect(isValidRepoIdentifier('/repo')).toBe(false);
    expect(isValidRepoIdentifier('owner/')).toBe(false);
    expect(isValidRepoIdentifier('/')).toBe(false);
  });

  it('should reject empty string, null, undefined', () => {
    expect(isValidRepoIdentifier('')).toBe(false);
    expect(isValidRepoIdentifier(null as unknown as string)).toBe(false);
    expect(isValidRepoIdentifier(undefined as unknown as string)).toBe(false);
  });

  it('should reject owners starting or ending with hyphen', () => {
    expect(isValidRepoIdentifier('-owner/repo')).toBe(false);
    expect(isValidRepoIdentifier('owner-/repo')).toBe(false);
  });

  it('should reject owners longer than 39 characters', () => {
    const longOwner = 'a'.repeat(40);
    expect(isValidRepoIdentifier(`${longOwner}/repo`)).toBe(false);
  });

  it('should reject repo names longer than 100 characters', () => {
    const longRepo = 'a'.repeat(101);
    expect(isValidRepoIdentifier(`owner/${longRepo}`)).toBe(false);
  });

  it('should accept repos with dots, hyphens, underscores', () => {
    expect(isValidRepoIdentifier('owner/my.repo-name_v2')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseRepoIdentifier
// ---------------------------------------------------------------------------
describe('parseRepoIdentifier', () => {
  it('should parse a valid repo identifier', () => {
    const result = parseRepoIdentifier('octocat/Hello-World');
    expect(result).toEqual({ owner: 'octocat', repo: 'Hello-World' });
  });

  it('should return null for invalid identifiers', () => {
    expect(parseRepoIdentifier('invalid')).toBeNull();
    expect(parseRepoIdentifier('')).toBeNull();
    expect(parseRepoIdentifier(null as unknown as string)).toBeNull();
  });

  it('should trim whitespace before parsing', () => {
    const result = parseRepoIdentifier('  octocat/Hello-World  ');
    expect(result).toEqual({ owner: 'octocat', repo: 'Hello-World' });
  });

  it('should return correct owner and repo for complex names', () => {
    const result = parseRepoIdentifier('my-org/my.complex_repo-v2');
    expect(result).toEqual({ owner: 'my-org', repo: 'my.complex_repo-v2' });
  });
});
