import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FleetLoadingBanner } from './FleetLoadingBanner';

describe('FleetLoadingBanner', () => {
  it('renders nothing when fleet data is not loading', () => {
    const { container } = render(<FleetLoadingBanner loading={false} ready={3} total={3} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('announces fleet loading progress while data is loading', () => {
    render(<FleetLoadingBanner loading ready={2} total={5} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading fleet data… 2/5 repos');
  });
});
