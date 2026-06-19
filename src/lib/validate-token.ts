const GITHUB_USER_ENDPOINT = 'https://api.github.com/user';
const GITHUB_API_VERSION = '2022-11-28';

/** Successful identity captured from `GET /user`. */
export interface ValidateTokenSuccess {
  ok: true;
  login: string;
  avatarUrl: string;
}

/** A validation failure carrying a human-friendly, token-free message. */
export interface ValidateTokenFailure {
  ok: false;
  error: string;
}

export type ValidateTokenResult = ValidateTokenSuccess | ValidateTokenFailure;

function readString(source: unknown, key: string): string | null {
  if (typeof source === 'object' && source !== null && key in source) {
    const value = (source as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : null;
  }
  return null;
}

/**
 * Validates a fine-grained PAT by calling `GET https://api.github.com/user`.
 *
 * Privacy invariant (ADR-004): this is the only network call here and it targets
 * `api.github.com` exclusively. The token is sent solely in the `Authorization`
 * header and is never logged or echoed back in an error.
 *
 * This module is intentionally self-contained (no `src/api/**` import) so it can
 * ship independently of the in-flight integration layer.
 *
 * @returns `{ ok: true, login, avatarUrl }` on HTTP 200, otherwise
 *   `{ ok: false, error }` with a message safe to display to the user.
 */
export async function validateToken(token: string): Promise<ValidateTokenResult> {
  let response: Response;
  try {
    response = await fetch(GITHUB_USER_ENDPOINT, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
    });
  } catch {
    return {
      ok: false,
      error: 'Network error — could not reach GitHub. Check your connection and try again.',
    };
  }

  if (response.status === 401) {
    return { ok: false, error: 'Invalid or expired token' };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `Could not validate the token (HTTP ${String(response.status)}). Please try again.`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: 'Unexpected response from GitHub. Please try again.' };
  }

  const login = readString(body, 'login');
  const avatarUrl = readString(body, 'avatar_url');
  if (login === null || avatarUrl === null) {
    return { ok: false, error: 'Unexpected response from GitHub. Please try again.' };
  }

  return { ok: true, login, avatarUrl };
}
