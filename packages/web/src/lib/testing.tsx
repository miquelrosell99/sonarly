// Shared render helper for page tests that read server state through
// react-query. Wraps the tree in a QueryClientProvider with retries off and
// a fresh (or caller-supplied) client so every render starts with an empty
// cache and failed queries reject immediately.
import { type ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

export function renderWithQueryClient(ui: ReactElement, queryClient = createTestQueryClient()) {
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}
