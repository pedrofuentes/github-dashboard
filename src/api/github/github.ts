/**
 * GitHub token validation, repository parsing, and count formatting helpers.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/**
 * Validates that a GitHub personal access token (PAT) has the expected format.
 * Supports both classic tokens (ghp_) and fine-grained tokens (github_pat_).
 *
 * @param token - The token string to validate
 * @returns true if the token matches a known GitHub PAT format
 */
export function isValidGitHubToken(token: string): boolean {
  if (!token || typeof token !== 'string') {
    return false;
  }

  const trimmed = token.trim();

  // Classic personal access tokens: ghp_ followed by 36 alphanumeric chars
  if (/^ghp_[a-zA-Z0-9]{36}$/.test(trimmed)) {
    return true;
  }

  // Fine-grained personal access tokens: github_pat_ followed by 22_62 chars
  if (/^github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}$/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Masks a GitHub token for safe display in logs or UI.
 * Shows only the first 7 characters followed by asterisks.
 *
 * @param token - The token to mask
 * @returns The masked token string
 */
export function maskToken(token: string): string {
  if (!token || token.length < 8) {
    return '****';
  }
  return `${token.substring(0, 7)}${'*'.repeat(Math.max(token.length - 7, 4))}`;
}

/**
 * Formats a number into a human-readable abbreviated string.
 * For example: 1500 -> "1.5k", 1200000 -> "1.2M"
 *
 * @param num - The number to format
 * @returns The formatted string
 */
export function formatCount(num: number): string {
  if (num === null || num === undefined || isNaN(num)) {
    return '0';
  }

  if (num < 0) {
    return `-${formatCount(Math.abs(num))}`;
  }

  if (num < 1000) {
    return num.toString();
  }

  if (num < 1_000_000) {
    const value = num / 1000;
    return `${parseFloat(value.toFixed(1))}k`;
  }

  if (num < 1_000_000_000) {
    const value = num / 1_000_000;
    return `${parseFloat(value.toFixed(1))}M`;
  }

  const value = num / 1_000_000_000;
  return `${parseFloat(value.toFixed(1))}B`;
}

/**
 * Validates a GitHub repository identifier in the format "owner/repo".
 *
 * @param repo - The repository string to validate
 * @returns true if the string is a valid owner/repo format
 */
export function isValidRepoIdentifier(repo: string): boolean {
  if (!repo || typeof repo !== 'string') {
    return false;
  }

  const trimmed = repo.trim();

  // GitHub username: 1-39 chars, alphanumeric or hyphen, cannot start/end with hyphen
  // Repo name: 1-100 chars, alphanumeric, hyphen, underscore, or period
  const repoRegex = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?\/[a-zA-Z0-9._-]{1,100}$/;
  return repoRegex.test(trimmed);
}

/**
 * Parses a GitHub repository identifier into owner and repo name.
 *
 * @param repo - The repository string in "owner/repo" format
 * @returns An object with owner and repo, or null if invalid
 */
export function parseRepoIdentifier(repo: string): { owner: string; repo: string } | null {
  if (!isValidRepoIdentifier(repo)) {
    return null;
  }

  const [owner, repoName] = repo.trim().split('/');
  return { owner, repo: repoName };
}
