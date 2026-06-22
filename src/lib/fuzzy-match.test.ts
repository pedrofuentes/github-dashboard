import { describe, it, expect } from 'vitest';
import { fuzzyMatch, fuzzyRank, fuzzyRankBy } from './fuzzy-match';

describe('fuzzyMatch', () => {
  describe('basic subsequence matching', () => {
    it('matches when query chars appear in order', () => {
      const result = fuzzyMatch('gd', 'github-dashboard');
      expect(result.matched).toBe(true);
      expect(result.score).toBeGreaterThan(0);
      expect(result.indices).toEqual([0, 7]); // 'g' at 0, 'd' at 7
    });

    it('does not match when query chars are out of order', () => {
      const result = fuzzyMatch('dg', 'github-dashboard');
      expect(result.matched).toBe(false);
      expect(result.score).toBe(0);
      expect(result.indices).toEqual([]);
    });

    it('does not match when query char is missing', () => {
      const result = fuzzyMatch('xyz', 'github-dashboard');
      expect(result.matched).toBe(false);
      expect(result.score).toBe(0);
      expect(result.indices).toEqual([]);
    });
  });

  describe('case insensitivity', () => {
    it('matches regardless of case', () => {
      const result1 = fuzzyMatch('GD', 'github-dashboard');
      const result2 = fuzzyMatch('gd', 'GITHUB-DASHBOARD');
      const result3 = fuzzyMatch('Gd', 'GiThUb-DaShBoArD');

      expect(result1.matched).toBe(true);
      expect(result2.matched).toBe(true);
      expect(result3.matched).toBe(true);
    });
  });

  describe('empty query', () => {
    it('matches everything with score 0 and empty indices', () => {
      const result = fuzzyMatch('', 'github-dashboard');
      expect(result.matched).toBe(true);
      expect(result.score).toBe(0);
      expect(result.indices).toEqual([]);
    });
  });

  describe('scoring: contiguous runs', () => {
    it('scores contiguous matches higher than scattered', () => {
      const contiguous = fuzzyMatch('git', 'github-dashboard'); // 'git' at 0-2
      const scattered = fuzzyMatch('git', 'g-i-t-h-u-b'); // 'g' at 0, 'i' at 2, 't' at 4

      expect(contiguous.score).toBeGreaterThan(scattered.score);
    });
  });

  describe('scoring: boundary matches', () => {
    it('scores word boundary matches higher', () => {
      const boundary = fuzzyMatch('gd', 'github-dashboard'); // start + after '-'
      const midWord = fuzzyMatch('it', 'github-dashboard'); // mid-word 'i' and 't'

      expect(boundary.score).toBeGreaterThan(midWord.score);
    });

    it('scores camelCase boundary matches higher', () => {
      const camelBoundary = fuzzyMatch('gc', 'getUserConfig'); // 'g' at start, 'C' at camelCase boundary
      const midWord = fuzzyMatch('se', 'getUserConfig'); // mid-word

      expect(camelBoundary.score).toBeGreaterThan(midWord.score);
    });

    it('scores start position (index 0) higher', () => {
      const atStart = fuzzyMatch('g', 'github');
      const notStart = fuzzyMatch('i', 'github');

      expect(atStart.score).toBeGreaterThan(notStart.score);
    });
  });

  describe('scoring: gap penalty', () => {
    it('penalizes longer gaps between matches', () => {
      const shortGap = fuzzyMatch('gh', 'github'); // gap of 2
      const longGap = fuzzyMatch('gh', 'g-------h'); // gap of 7

      expect(shortGap.score).toBeGreaterThan(longGap.score);
    });
  });

  describe('scoring: target length penalty', () => {
    it('lightly penalizes longer targets', () => {
      const shorter = fuzzyMatch('gh', 'github');
      const longer = fuzzyMatch('gh', 'github-dashboard-project');

      // Both match at the same positions, but longer target should score slightly lower
      expect(shorter.score).toBeGreaterThan(longer.score);
    });
  });

  describe('indices correctness', () => {
    it('returns correct match positions', () => {
      expect(fuzzyMatch('gd', 'github-dashboard').indices).toEqual([0, 7]);
      expect(fuzzyMatch('hub', 'github-dashboard').indices).toEqual([3, 4, 5]);
      expect(fuzzyMatch('rd', 'react-dashboard').indices).toEqual([0, 6]);
    });

    it('returns empty indices for non-matches', () => {
      expect(fuzzyMatch('xyz', 'github').indices).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('matches single character query', () => {
      const result = fuzzyMatch('g', 'github');
      expect(result.matched).toBe(true);
      expect(result.indices).toEqual([0]);
    });

    it('matches query equal to target', () => {
      const result = fuzzyMatch('github', 'github');
      expect(result.matched).toBe(true);
      expect(result.indices).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('handles empty target', () => {
      const result = fuzzyMatch('g', '');
      expect(result.matched).toBe(false);
      expect(result.score).toBe(0);
      expect(result.indices).toEqual([]);
    });

    it('handles both empty', () => {
      const result = fuzzyMatch('', '');
      expect(result.matched).toBe(true);
      expect(result.score).toBe(0);
      expect(result.indices).toEqual([]);
    });
  });
});

describe('fuzzyRank', () => {
  interface TestItem {
    id: number;
    name: string;
  }

  const items: TestItem[] = [
    { id: 1, name: 'github-dashboard' },
    { id: 2, name: 'react-dashboard' },
    { id: 3, name: 'dashboard-app' },
    { id: 4, name: 'git-helper' },
    { id: 5, name: 'no-match-here' },
  ];

  describe('filtering and ranking', () => {
    it('returns only matching items', () => {
      const results = fuzzyRank('dash', items, (item) => item.name);
      const ids = results.map((r) => r.id);

      expect(ids).toContain(1); // github-dashboard
      expect(ids).toContain(2); // react-dashboard
      expect(ids).toContain(3); // dashboard-app
      expect(ids).not.toContain(4); // git-helper
      expect(ids).not.toContain(5); // no-match-here
    });

    it('ranks by descending score', () => {
      const results = fuzzyRank('gd', items, (item) => item.name);
      // 'github-dashboard' should rank higher (boundary match at start + after '-')
      // than other potential matches
      expect(results[0].id).toBe(1);
    });

    it('ranks prefix/boundary matches higher than mid-word', () => {
      const results = fuzzyRank('rd', items, (item) => item.name);
      // 'react-dashboard' has 'r' at start and 'd' at boundary
      // should rank higher than mid-word matches
      expect(results[0].id).toBe(2);
    });
  });

  describe('tie-breaking', () => {
    it('breaks score ties by shorter key length', () => {
      const tieItems: TestItem[] = [
        { id: 1, name: 'app-dashboard-project' }, // longer
        { id: 2, name: 'app-dash' }, // shorter
      ];

      const results = fuzzyRank('ad', tieItems, (item) => item.name);
      // Both start with 'a', have 'd' after boundary
      // Shorter should come first
      expect(results[0].id).toBe(2);
    });

    it('preserves original order for equal scores and lengths', () => {
      const orderItems: TestItem[] = [
        { id: 1, name: 'test' },
        { id: 2, name: 'test' },
        { id: 3, name: 'test' },
      ];

      const results = fuzzyRank('t', orderItems, (item) => item.name);
      expect(results.map((r) => r.id)).toEqual([1, 2, 3]);
    });
  });

  describe('empty query', () => {
    it('returns all items in original order', () => {
      const results = fuzzyRank('', items, (item) => item.name);
      expect(results).toEqual(items);
      expect(results.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('no matches', () => {
    it('returns empty array when no items match', () => {
      const results = fuzzyRank('xyz', items, (item) => item.name);
      expect(results).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('handles empty items array', () => {
      const results = fuzzyRank('test', [] as TestItem[], (item) => item.name);
      expect(results).toEqual([]);
    });

    it('handles single item', () => {
      const singleItem = [{ id: 1, name: 'github' }];
      const results = fuzzyRank('gh', singleItem, (item) => item.name);
      expect(results).toEqual(singleItem);
    });
  });
});

describe('fuzzyRankBy', () => {
  interface RepoItem {
    id: number;
    nameWithOwner: string;
    owner: string;
    alias?: string;
  }

  const repos: RepoItem[] = [
    { id: 1, nameWithOwner: 'facebook/react', owner: 'facebook', alias: 'fb-react' },
    { id: 2, nameWithOwner: 'microsoft/typescript', owner: 'microsoft', alias: 'ms-ts' },
    { id: 3, nameWithOwner: 'github/github-dashboard', owner: 'github' },
  ];

  describe('best-of-keys matching', () => {
    it('matches against multiple keys and uses best score', () => {
      const results = fuzzyRankBy('fb', repos, (item) => [
        item.nameWithOwner,
        item.owner,
        item.alias ?? '',
      ]);

      // Should match 'facebook' in owner and/or 'fb-react' in alias
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe(1);
    });

    it('ranks by best score across all keys', () => {
      const results = fuzzyRankBy('ms', repos, (item) => [
        item.nameWithOwner,
        item.owner,
        item.alias ?? '',
      ]);

      // 'microsoft' in owner should score well
      // 'ms-ts' in alias should also match
      expect(results[0].id).toBe(2);
    });

    it('matches when only one key matches', () => {
      const results = fuzzyRankBy('github', repos, (item) => [item.nameWithOwner, item.owner]);

      // Should find 'github' in both owner and nameWithOwner
      expect(results.some((r) => r.id === 3)).toBe(true);
    });
  });

  describe('filtering', () => {
    it('only returns items where at least one key matches', () => {
      const results = fuzzyRankBy('xyz', repos, (item) => [
        item.nameWithOwner,
        item.owner,
        item.alias ?? '',
      ]);

      expect(results).toEqual([]);
    });
  });

  describe('empty query', () => {
    it('returns all items in original order', () => {
      const results = fuzzyRankBy('', repos, (item) => [item.nameWithOwner, item.owner]);
      expect(results).toEqual(repos);
    });
  });

  describe('edge cases', () => {
    it('handles empty keys array', () => {
      const results = fuzzyRankBy('test', repos, () => []);
      expect(results).toEqual([]);
    });

    it('handles empty string keys', () => {
      const results = fuzzyRankBy('test', repos, () => ['']);
      expect(results).toEqual([]);
    });
  });
});
