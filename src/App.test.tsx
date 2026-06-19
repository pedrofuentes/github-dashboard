import { render, screen } from '@testing-library/react';

import { App } from './App';

describe('App', () => {
  it('renders the dashboard heading', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'github-dashboard' })).toBeInTheDocument();
  });

  it('renders a main landmark for accessibility', () => {
    render(<App />);

    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
