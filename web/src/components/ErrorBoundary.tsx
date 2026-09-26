import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// Report a client crash to the server so production render errors are
// diagnosable from logs. Fire-and-forget; never throws — including the
// rejection path (fetch failures must not surface as unhandled rejections).
export function reportClientError(message: string, stack?: string): void {
  try {
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.slice(0, 2000), stack: (stack ?? '').slice(0, 6000), route: window.location.pathname }),
    }).catch(() => {});
  } catch {
    /* never throw from error reporting */
  }
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
    const err = error instanceof Error ? error : new Error(String(error));
    const componentStack =
      info && typeof info === 'object' && 'componentStack' in info
        ? String((info as { componentStack?: unknown }).componentStack)
        : '';
    reportClientError(err.message, `${err.stack ?? ''}\ncomponentStack:${componentStack}`);
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
