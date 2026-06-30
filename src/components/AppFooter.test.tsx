import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const buildInfoMock = vi.hoisted(() => ({
  value: {
    sha: 'abc1234',
    builtAt: '2026-06-26T03:13:24.873Z',
  },
}));

const formatBuiltAtMock = vi.hoisted(() => ({
  fn: (iso?: string) => (iso ? '2026-06-26' : ''),
}));

vi.mock('../lib/build-info', () => ({
  get buildInfo() {
    return buildInfoMock.value;
  },
  formatBuiltAt: (iso?: string) => formatBuiltAtMock.fn(iso),
}));

import { AppFooter } from './AppFooter';

describe('AppFooter', () => {
  afterEach(() => {
    buildInfoMock.value = {
      sha: 'abc1234',
      builtAt: '2026-06-26T03:13:24.873Z',
    };
    formatBuiltAtMock.fn = (iso?: string) => (iso ? '2026-06-26' : '');
  });

  it('renders the build date and SHA', () => {
    render(<AppFooter />);

    expect(screen.getByRole('contentinfo')).toHaveTextContent('2026-06-26 · abc1234');
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
      sha: 'dev',
      builtAt: '2026-06-26T03:13:24.873Z',
    };

    render(<AppFooter />);

    expect(screen.getByRole('contentinfo')).toHaveTextContent('2026-06-26 · dev');
    expect(screen.queryByRole('link', { name: 'dev' })).not.toBeInTheDocument();
  });

  it('omits the build date and separator when builtAt is empty', () => {
    buildInfoMock.value = {
      sha: 'dev',
      builtAt: '',
    };

    render(<AppFooter />);

    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent('dev');
    expect(footer).not.toHaveTextContent('·');
    expect(screen.queryByRole('link', { name: 'dev' })).not.toBeInTheDocument();
  });
});
