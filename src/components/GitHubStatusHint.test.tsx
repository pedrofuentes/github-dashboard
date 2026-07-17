import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GITHUB_STATUS_URL } from '../lib/github-status';
import { GitHubStatusHint } from './GitHubStatusHint';

describe('GitHubStatusHint', () => {
  it('links to GitHub status with safe external-link attributes', () => {
    render(<GitHubStatusHint />);

    const link = screen.getByRole('link', { name: /check github status/i });
    expect(link).toHaveAttribute('href', GITHUB_STATUS_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });
});
