import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const buildInfoMock = vi.hoisted(() => ({
  value: {
    version: '1.2.3',
    sha: 'abc1234',
    builtAt: '2026-06-26T03:13:24.873Z',
  },
}));

vi.mock('../lib/build-info', () => ({
  get buildInfo() {
    return buildInfoMock.value;
  },
  formatBuiltAt: () => '2026-06-26',
}));

import { AppFooter } from './AppFooter';

describe('AppFooter', () => {
  afterEach(() => {
    buildInfoMock.value = {
      version: '1.2.3',
      sha: 'abc1234',
      builtAt: '2026-06-26T03:13:24.873Z',
    };
  });

  it('renders the version, SHA, and build date', () => {
    render(<AppFooter />);

    expect(screen.getByRole('contentinfo')).toHaveTextContent('v1.2.3 · abc1234 · 2026-06-26');
  });

  it('links the SHA to the GitHub commit when the SHA is known', () => {
    render(<AppFooter />);

    const link = screen.getByRole('link', { name: 'abc1234' });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/pedrofuentes/github-dashboard/commit/abc1234',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('renders the development SHA as plain text', () => {
    buildInfoMock.value = {
      version: 'dev',
      sha: 'dev',
      builtAt: '',
    };

    render(<AppFooter />);

    expect(screen.getByRole('contentinfo')).toHaveTextContent('vdev · dev · 2026-06-26');
    expect(screen.queryByRole('link', { name: 'dev' })).not.toBeInTheDocument();
  });
});
