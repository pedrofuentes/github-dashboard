import { describe, it, expect } from 'vitest';
import type { Repo, RepoSignalData } from '../types/fleet';
import type { TileSignalType } from '../types/dashboard';
import {
  MATRIX_SIGNALS,
  buildMatrixModel,
  compareRepoHealth,
  groupRowsByHealth,
  type MatrixRow,
} from './matrix-model';

const mockRepo = (name: string): Repo => ({
  nameWithOwner: name,
  owner: name.split('/')[0],
  name: name.split('/')[1],
  isPrivate: false,
});

const healthyData: RepoSignalData = {
  ci: { status: 'ready', conclusion: 'success' },
  security: { status: 'ready', grade: 'A' },
  issues: { status: 'ready', openCount: 5, overThreshold: false },
  stale: { status: 'ready', staleCount: 0 },
  reviews: { status: 'ready', requestedCount: 0 },
};

const warningData: RepoSignalData = {
  ci: { status: 'ready', conclusion: 'success' },
  security: { status: 'ready', grade: 'C' },
  issues: { status: 'ready', openCount: 5, overThreshold: false },
};

const brokenData: RepoSignalData = {
  ci: { status: 'ready', conclusion: 'failure' },
  security: { status: 'ready', grade: 'A' },
  issues: { status: 'ready', openCount: 5, overThreshold: false },
};

describe('matrix-model', () => {
  describe('MATRIX_SIGNALS', () => {
    it('exports the 7 signal types in a sensible display order', () => {
      expect(MATRIX_SIGNALS).toBeDefined();
      expect(MATRIX_SIGNALS).toHaveLength(7);
      expect(MATRIX_SIGNALS).toContain('ci');
      expect(MATRIX_SIGNALS).toContain('security');
      expect(MATRIX_SIGNALS).toContain('reviews');
      expect(MATRIX_SIGNALS).toContain('pullRequests');
      expect(MATRIX_SIGNALS).toContain('issues');
      expect(MATRIX_SIGNALS).toContain('stale');
      expect(MATRIX_SIGNALS).toContain('activity');
    });

    it('is readonly (type-level check via assignment)', () => {
      const signals: readonly TileSignalType[] = MATRIX_SIGNALS;
      expect(signals).toBe(MATRIX_SIGNALS);
    });
  });

  describe('compareRepoHealth', () => {
    it('orders broken before warning', () => {
      expect(compareRepoHealth('broken', 'warning')).toBeLessThan(0);
    });

    it('orders broken before healthy', () => {
      expect(compareRepoHealth('broken', 'healthy')).toBeLessThan(0);
    });

    it('orders warning before healthy', () => {
      expect(compareRepoHealth('warning', 'healthy')).toBeLessThan(0);
    });

    it('returns 0 for equal health values', () => {
      expect(compareRepoHealth('broken', 'broken')).toBe(0);
      expect(compareRepoHealth('warning', 'warning')).toBe(0);
      expect(compareRepoHealth('healthy', 'healthy')).toBe(0);
    });

    it('is a valid comparator (symmetric inverse)', () => {
      expect(compareRepoHealth('warning', 'broken')).toBeGreaterThan(0);
      expect(compareRepoHealth('healthy', 'warning')).toBeGreaterThan(0);
    });
  });

  describe('groupRowsByHealth', () => {
    it('groups rows by health in worst-first order', () => {
      const rows: MatrixRow[] = [
        { repo: mockRepo('a/r1'), health: 'healthy' },
        { repo: mockRepo('a/r2'), health: 'broken' },
        { repo: mockRepo('a/r3'), health: 'warning' },
        { repo: mockRepo('a/r4'), health: 'broken' },
      ];

      const groups = groupRowsByHealth(rows);

      expect(groups).toHaveLength(3);
      expect(groups[0].health).toBe('broken');
      expect(groups[0].rows).toHaveLength(2);
      expect(groups[1].health).toBe('warning');
      expect(groups[1].rows).toHaveLength(1);
      expect(groups[2].health).toBe('healthy');
      expect(groups[2].rows).toHaveLength(1);
    });

    it('omits groups with zero rows', () => {
      const rows: MatrixRow[] = [
        { repo: mockRepo('a/r1'), health: 'broken' },
        { repo: mockRepo('a/r2'), health: 'healthy' },
      ];

      const groups = groupRowsByHealth(rows);

      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.health)).toEqual(['broken', 'healthy']);
    });

    it('preserves row order within each group', () => {
      const rows: MatrixRow[] = [
        { repo: mockRepo('a/r1'), health: 'broken' },
        { repo: mockRepo('a/r2'), health: 'broken' },
        { repo: mockRepo('a/r3'), health: 'broken' },
      ];

      const groups = groupRowsByHealth(rows);

      expect(groups).toHaveLength(1);
      expect(groups[0].rows.map((r) => r.repo.nameWithOwner)).toEqual(['a/r1', 'a/r2', 'a/r3']);
    });

    it('handles empty input', () => {
      const groups = groupRowsByHealth([]);
      expect(groups).toEqual([]);
    });
  });

  describe('buildMatrixModel', () => {
    it('builds a model with worst-first sorted rows', () => {
      const repos = [
        mockRepo('a/healthy'),
        mockRepo('b/broken'),
        mockRepo('c/warning'),
        mockRepo('d/healthy2'),
      ];

      const dataMap = new Map<string, RepoSignalData>([
        ['a/healthy', healthyData],
        ['b/broken', brokenData],
        ['c/warning', warningData],
        ['d/healthy2', healthyData],
      ]);

      const getRowData = (repo: Repo) => {
        const data = dataMap.get(repo.nameWithOwner);
        if (!data) throw new Error(`Missing test data for ${repo.nameWithOwner}`);
        return data;
      };
      const model = buildMatrixModel(repos, getRowData);

      expect(model.rows).toHaveLength(4);
      expect(model.rows[0].repo.nameWithOwner).toBe('b/broken');
      expect(model.rows[0].health).toBe('broken');
      expect(model.rows[1].repo.nameWithOwner).toBe('c/warning');
      expect(model.rows[1].health).toBe('warning');
      expect(model.rows[2].repo.nameWithOwner).toBe('a/healthy');
      expect(model.rows[2].health).toBe('healthy');
      expect(model.rows[3].repo.nameWithOwner).toBe('d/healthy2');
      expect(model.rows[3].health).toBe('healthy');
    });

    it('preserves input order within the same health band (stable sort)', () => {
      const repos = [mockRepo('a/h1'), mockRepo('b/h2'), mockRepo('c/h3'), mockRepo('d/h4')];

      const dataMap = new Map<string, RepoSignalData>([
        ['a/h1', healthyData],
        ['b/h2', healthyData],
        ['c/h3', healthyData],
        ['d/h4', healthyData],
      ]);

      const getRowData = (repo: Repo) => {
        const data = dataMap.get(repo.nameWithOwner);
        if (!data) throw new Error(`Missing test data for ${repo.nameWithOwner}`);
        return data;
      };
      const model = buildMatrixModel(repos, getRowData);

      expect(model.rows.map((r) => r.repo.nameWithOwner)).toEqual(['a/h1', 'b/h2', 'c/h3', 'd/h4']);
    });

    it('groups rows by health and omits empty groups', () => {
      const repos = [mockRepo('a/broken'), mockRepo('b/healthy')];

      const dataMap = new Map<string, RepoSignalData>([
        ['a/broken', brokenData],
        ['b/healthy', healthyData],
      ]);

      const getRowData = (repo: Repo) => {
        const data = dataMap.get(repo.nameWithOwner);
        if (!data) throw new Error(`Missing test data for ${repo.nameWithOwner}`);
        return data;
      };
      const model = buildMatrixModel(repos, getRowData);

      expect(model.groups).toHaveLength(2);
      expect(model.groups[0].health).toBe('broken');
      expect(model.groups[0].rows).toHaveLength(1);
      expect(model.groups[1].health).toBe('healthy');
      expect(model.groups[1].rows).toHaveLength(1);
    });

    it('includes the MATRIX_SIGNALS reference', () => {
      const repos = [mockRepo('a/r1')];
      const getRowData = () => healthyData;

      const model = buildMatrixModel(repos, getRowData);

      expect(model.signals).toBe(MATRIX_SIGNALS);
    });

    it('calculates correct counts', () => {
      const repos = [
        mockRepo('a/broken1'),
        mockRepo('b/broken2'),
        mockRepo('c/warning'),
        mockRepo('d/healthy1'),
        mockRepo('e/healthy2'),
        mockRepo('f/healthy3'),
      ];

      const dataMap = new Map<string, RepoSignalData>([
        ['a/broken1', brokenData],
        ['b/broken2', brokenData],
        ['c/warning', warningData],
        ['d/healthy1', healthyData],
        ['e/healthy2', healthyData],
        ['f/healthy3', healthyData],
      ]);

      const getRowData = (repo: Repo) => {
        const data = dataMap.get(repo.nameWithOwner);
        if (!data) throw new Error(`Missing test data for ${repo.nameWithOwner}`);
        return data;
      };
      const model = buildMatrixModel(repos, getRowData);

      expect(model.counts).toEqual({
        broken: 2,
        warning: 1,
        healthy: 3,
        total: 6,
      });
    });

    it('handles a fleet of all healthy repos', () => {
      const repos = [mockRepo('a/r1'), mockRepo('b/r2')];
      const getRowData = () => healthyData;

      const model = buildMatrixModel(repos, getRowData);

      expect(model.groups).toHaveLength(1);
      expect(model.groups[0].health).toBe('healthy');
      expect(model.counts).toEqual({
        broken: 0,
        warning: 0,
        healthy: 2,
        total: 2,
      });
    });

    it('handles a mixed fleet', () => {
      const repos = [mockRepo('a/broken'), mockRepo('b/warning'), mockRepo('c/healthy')];

      const dataMap = new Map<string, RepoSignalData>([
        ['a/broken', brokenData],
        ['b/warning', warningData],
        ['c/healthy', healthyData],
      ]);

      const getRowData = (repo: Repo) => {
        const data = dataMap.get(repo.nameWithOwner);
        if (!data) throw new Error(`Missing test data for ${repo.nameWithOwner}`);
        return data;
      };
      const model = buildMatrixModel(repos, getRowData);

      expect(model.groups).toHaveLength(3);
      expect(model.rows).toHaveLength(3);
      expect(model.counts.total).toBe(3);
    });

    it('does not mutate the input repos array', () => {
      const repos = [mockRepo('a/r1'), mockRepo('b/r2')];
      const original = [...repos];
      const getRowData = () => healthyData;

      buildMatrixModel(repos, getRowData);

      expect(repos).toEqual(original);
    });

    it('handles empty repos array', () => {
      const getRowData = () => healthyData;
      const model = buildMatrixModel([], getRowData);

      expect(model.rows).toEqual([]);
      expect(model.groups).toEqual([]);
      expect(model.counts).toEqual({
        broken: 0,
        warning: 0,
        healthy: 0,
        total: 0,
      });
    });
  });
});
