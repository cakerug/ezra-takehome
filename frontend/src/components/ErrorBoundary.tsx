import { Component } from 'react';
import type { ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Clears react-query's error state so a retry actually re-runs the failed queries, not just
   * re-render the same cached error. Passed down from `QueryErrorResetBoundary` in main.tsx. */
  onReset: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort net for errors thrown during render by any descendant -- i.e. genuine render-time
 * bugs, not load failures (those surface as a toast via the queryCache onError in main.tsx). Shows
 * one fallback page instead of a blank white screen. Mounted once at the app root (main.tsx).
 *
 * Must be a class component: React has no hook equivalent for `componentDidCatch` /
 * `getDerivedStateFromError`.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Dev-only, mirroring the console dump in client.ts. In production this swallows the error
    // entirely: there's no error-reporting service (e.g. Sentry) wired up, so a prod user who
    // hits this gets the fallback UI below and nothing else -- no report reaches us unless they
    // tell us directly. This boundary is the natural single hook point to wire that up later.
    if (import.meta.env.DEV) {
      console.error('ErrorBoundary caught:', error);
    }
  }

  handleRetry = (): void => {
    this.props.onReset();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div className="error-boundary" role="alert">
        <h1 className="error-boundary__title">Something went wrong</h1>
        <p className="error-boundary__message">
          We couldn't load the app. Check your connection and try again.
        </p>
        <button type="button" className="btn btn--primary" onClick={this.handleRetry}>
          Retry
        </button>
        {import.meta.env.DEV && (
          <details className="error-boundary__detail">
            <summary>Error detail (dev only)</summary>
            <pre>{error.message}</pre>
          </details>
        )}
      </div>
    );
  }
}
