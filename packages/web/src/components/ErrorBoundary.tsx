import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// FF10: a render crash in any page must not unmount the whole React root
// (white screen with audio still playing). This class boundary catches
// errors below the route outlet and offers a reload; the player chrome
// outside the boundary keeps working.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown): void {
    console.error('ErrorBoundary caught a render error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex h-full min-h-[16rem] items-center justify-center p-6 text-fg-secondary"
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="text-base font-medium text-fg-primary">Something went wrong</span>
            <span className="text-sm">This view crashed unexpectedly.</span>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg-primary transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
