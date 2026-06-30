/**
 * Result of a fuzzy match operation.
 */
export interface FuzzyMatchResult {
  /** Whether the query matched the target */
  matched: boolean;
  /** Match score (higher is better). 0 if not matched, or clamped to 0 if penalties exceed bonuses. */
  score: number;
  /** Indices of matched characters in the target string */
  indices: number[];
}

function toChars(value: string): string[] {
  return Array.from(value);
}

/**
 * Performs a fuzzy subsequence match of query against target.
 *
 * Scoring algorithm:
 * - Base score starts at 100 per matched character
 * - Bonus: +50 for match at start (index 0)
 * - Bonus: +20 for match at word/separator boundary (after space, -, _, ., /)
 * - Bonus: +15 for match at camelCase boundary (uppercase after lowercase)
 * - Bonus: each character extending a contiguous run adds min(40, run_length × 8)
 *   to the score (applied once per matched character in the run; a 3-char run
 *   contributes 16 + 24 = 40; longer runs accumulate more, without per-char cap)
 * - Penalty: -5 per character gap between matches
 * - Penalty: -0.1 per character of target length
 *
 * @param query - The search string (case-insensitive)
 * @param target - The string to search within (case-insensitive)
 * @returns Match result with scored indices
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatchResult {
  // Empty query matches everything with score 0
  if (query.length === 0) {
    return { matched: true, score: 0, indices: [] };
  }

  // Empty target cannot match non-empty query
  if (target.length === 0) {
    return { matched: false, score: 0, indices: [] };
  }

  return fuzzyMatchChars(
    toChars(query).map((char) => char.toLowerCase()),
    toChars(target),
  );
}

/**
 * Core fuzzy-match scorer operating on already-converted code-point arrays.
 *
 * Both inputs MUST be non-empty: callers handle the empty-query / empty-target
 * fast paths ({@link fuzzyMatch}) and skip empty keys ({@link fuzzyRankBy}) before
 * reaching here. Splitting this out lets the ranking hot path convert each key to
 * code points once and reuse it for both the match and the length tie-break,
 * instead of re-running `toChars` inside every `fuzzyMatch` call (#579).
 *
 * @param queryLowerChars - Lower-cased code points of the query.
 * @param targetChars - Code points of the target in original case.
 */
function fuzzyMatchChars(queryLowerChars: string[], targetChars: string[]): FuzzyMatchResult {
  const targetLowerChars = targetChars.map((char) => char.toLowerCase());

  // Find subsequence match and collect indices
  const indices: number[] = [];
  let targetIdx = 0;

  for (const queryChar of queryLowerChars) {
    let found = false;

    while (targetIdx < targetLowerChars.length) {
      if (targetLowerChars[targetIdx] === queryChar) {
        indices.push(targetIdx);
        targetIdx++;
        found = true;
        break;
      }
      targetIdx++;
    }

    if (!found) {
      return { matched: false, score: 0, indices: [] };
    }
  }

  // Calculate score based on match quality
  let score = 0;

  // Base score: 100 points per matched character
  score += indices.length * 100;

  // Bonus for each matched position
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];

    // Start bonus (strong preference for prefix matches)
    if (idx === 0) {
      score += 50;
    }

    // Boundary bonuses (word boundary, separator, camelCase)
    if (idx > 0) {
      const prevChar = targetChars[idx - 1];
      const currChar = targetChars[idx];

      // After separator: space, -, _, ., /
      if (/[\s\-_./]/.test(prevChar)) {
        score += 20;
      }
      // CamelCase boundary: lowercase followed by uppercase
      else if (
        prevChar === prevChar.toLowerCase() &&
        currChar === currChar.toUpperCase() &&
        /[a-z]/.test(prevChar) &&
        /[A-Z]/.test(currChar)
      ) {
        score += 15;
      }
    }

    // Contiguous run bonus: each character in a run adds min(40, run_length × 8),
    // where run_length is the number of consecutive matched characters up to and
    // including the current position (i.e. later characters in the run earn more).
    if (i > 0 && indices[i] === indices[i - 1] + 1) {
      // Count how many consecutive matched characters end at position i.
      let runLength = 2;
      let j = i - 1;
      while (j > 0 && indices[j] === indices[j - 1] + 1) {
        runLength++;
        j--;
      }
      score += Math.min(40, runLength * 8);
    }
  }

  // Gap penalty: strongly penalize distance between matches
  for (let i = 1; i < indices.length; i++) {
    const gap = indices[i] - indices[i - 1] - 1;
    score -= gap * 5;
  }

  // Target length penalty (lightly penalize longer strings)
  score -= targetChars.length * 0.1;

  return { matched: true, score: Math.max(0, score), indices };
}

/**
 * Ranks items by fuzzy matching a query against a key extracted from each item.
 *
 * @param query - The search string
 * @param items - Array of items to rank
 * @param keyFn - Function to extract the searchable key from each item
 * @returns Filtered and sorted array of matching items (descending score)
 *
 * Tie-breaking order:
 * 1. Higher score wins
 * 2. Shorter key length wins
 * 3. Original order preserved (stable sort)
 */
export function fuzzyRank<T>(query: string, items: readonly T[], keyFn: (item: T) => string): T[] {
  // Empty query returns all items in original order
  if (query.length === 0) {
    return [...items];
  }

  // Match and score each item
  const scored = items
    .map((item, originalIndex) => {
      const key = keyFn(item);
      const result = fuzzyMatch(query, key);
      return {
        item,
        result,
        keyLength: key.length,
        originalIndex,
      };
    })
    .filter((entry) => entry.result.matched);

  // Sort by: score DESC, keyLength ASC, originalIndex ASC
  scored.sort((a, b) => {
    // Higher score wins
    if (a.result.score !== b.result.score) {
      return b.result.score - a.result.score;
    }
    // Shorter key wins
    if (a.keyLength !== b.keyLength) {
      return a.keyLength - b.keyLength;
    }
    // Preserve original order
    return a.originalIndex - b.originalIndex;
  });

  return scored.map((entry) => entry.item);
}

/**
 * Ranks items by fuzzy matching against multiple keys per item.
 * Uses the BEST score across all keys for each item.
 *
 * @param query - The search string
 * @param items - Array of items to rank
 * @param keysFn - Function to extract multiple searchable keys from each item
 * @returns Filtered and sorted array of matching items (descending best score)
 *
 * Tie-breaking order:
 * 1. Higher score wins
 * 2. Shorter best-match key length wins
 * 3. Original order preserved (stable sort)
 */
export function fuzzyRankBy<T>(
  query: string,
  items: readonly T[],
  keysFn: (item: T) => string[],
): T[] {
  // Empty query returns all items in original order
  if (query.length === 0) {
    return [...items];
  }

  // Convert the query to lower-cased code points once for the whole ranking pass
  // instead of re-running toChars inside every per-key fuzzyMatch call (#579).
  const queryLowerChars = toChars(query).map((char) => char.toLowerCase());

  // Match against all keys and keep the best score
  const scored = items
    .map((item, originalIndex) => {
      const keys = keysFn(item);
      let bestResult: FuzzyMatchResult = { matched: false, score: 0, indices: [] };
      let bestKeyLength = Infinity;

      for (const key of keys) {
        if (key.length === 0) continue;

        // Convert each key to code points once and reuse it for both the match
        // and the length tie-break, avoiding a second toChars per key (#579).
        const keyChars = toChars(key);
        const result = fuzzyMatchChars(queryLowerChars, keyChars);
        const keyLength = keyChars.length;
        if (
          result.matched &&
          (!bestResult.matched ||
            result.score > bestResult.score ||
            (result.score === bestResult.score && keyLength < bestKeyLength))
        ) {
          bestResult = result;
          bestKeyLength = keyLength;
        }
      }

      return {
        item,
        result: bestResult,
        keyLength: bestKeyLength,
        originalIndex,
      };
    })
    .filter((entry) => entry.result.matched);

  // Sort by: score DESC, keyLength ASC, originalIndex ASC
  scored.sort((a, b) => {
    // Higher score wins
    if (a.result.score !== b.result.score) {
      return b.result.score - a.result.score;
    }
    // Shorter key wins
    if (a.keyLength !== b.keyLength) {
      return a.keyLength - b.keyLength;
    }
    // Preserve original order
    return a.originalIndex - b.originalIndex;
  });

  return scored.map((entry) => entry.item);
}
