/**
 * Result of a fuzzy match operation.
 */
export interface FuzzyMatchResult {
  /** Whether the query matched the target */
  matched: boolean;
  /** Match score (higher is better). 0 if not matched. */
  score: number;
  /** Indices of matched characters in the target string */
  indices: number[];
}

/**
 * Performs a fuzzy subsequence match of query against target.
 *
 * Scoring algorithm:
 * - Base score starts at 100 per matched character
 * - Bonus: +50 for match at start (index 0)
 * - Bonus: +20 for match at word/separator boundary (after space, -, _, ., /)
 * - Bonus: +15 for match at camelCase boundary (uppercase after lowercase)
 * - Bonus: up to +40 for contiguous character runs (scales with run length × 8)
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

  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();

  // Find subsequence match and collect indices
  const indices: number[] = [];
  let targetIdx = 0;

  for (let queryIdx = 0; queryIdx < queryLower.length; queryIdx++) {
    const queryChar = queryLower[queryIdx];
    let found = false;

    while (targetIdx < targetLower.length) {
      if (targetLower[targetIdx] === queryChar) {
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
      const prevChar = target[idx - 1];
      const currChar = target[idx];

      // After separator: space, -, _, ., /
      if (/[\s\-_.\/]/.test(prevChar)) {
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

    // Contiguous run bonus (strong bonus for consecutive matches)
    if (i > 0 && indices[i] === indices[i - 1] + 1) {
      // Scale bonus with position in run (later chars in run = more bonus)
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
  score -= target.length * 0.1;

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
export function fuzzyRank<T>(
  query: string,
  items: readonly T[],
  keyFn: (item: T) => string,
): T[] {
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

  // Match against all keys and keep the best score
  const scored = items
    .map((item, originalIndex) => {
      const keys = keysFn(item);
      let bestResult: FuzzyMatchResult = { matched: false, score: 0, indices: [] };
      let bestKeyLength = Infinity;

      for (const key of keys) {
        if (key.length === 0) continue;

        const result = fuzzyMatch(query, key);
        if (result.matched && result.score > bestResult.score) {
          bestResult = result;
          bestKeyLength = key.length;
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
