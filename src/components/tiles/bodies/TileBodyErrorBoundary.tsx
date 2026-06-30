/**
 * TileBodyErrorBoundary — a React error boundary that wraps tile body
 * components to isolate render errors. When a tile body throws during render,
 * this boundary catches the error and displays a graceful fallback (via
 * {@link TileMessage}), preventing the error from cascading and crashing
 * sibling tiles or the entire dashboard.
 *
 * Addresses #190 (no runtime error boundary above tile bodies).
 *
 * USAGE (to be wired in TileFrame or parent):
 * ```tsx
 * <TileBodyErrorBoundary>
 *   <IssuesTileBody repo={repo} data={data} size={size} />
 * </TileBodyErrorBoundary>
 * ```
 */
import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

import { TileMessage } from '../TileMessage';

interface TileBodyErrorBoundaryProps {
  children: ReactNode;
}

interface TileBodyErrorBoundaryState {
  hasError: boolean;
}

/**
 * React error boundary for tile bodies. Catches render errors and shows a
 * "Couldn't display" fallback (`data-state="failed-to-load"`) so one broken
 * tile doesn't crash the dashboard.
 */
export class TileBodyErrorBoundary extends Component<
  TileBodyErrorBoundaryProps,
  TileBodyErrorBoundaryState
> {
  constructor(props: TileBodyErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): TileBodyErrorBoundaryState {
    // Update state so the next render shows the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log the error for debugging (in production this would go to a logging service)
    console.error('TileBodyErrorBoundary caught an error:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <TileMessage
          kind="failed"
          message="Couldn't display"
          srText="This tile couldn't display due to an error"
        />
      );
    }

    return this.props.children;
  }
}
