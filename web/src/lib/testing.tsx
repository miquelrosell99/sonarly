// Shared render helper for page tests that read server state through
// react-query. Wraps the tree in a QueryClientProvider with retries off and
// a fresh (or caller-supplied) client so every render starts with an empty
// cache and failed queries reject immediately.
import { type ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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

// Radix Select interaction for tests. The catalog Select replaced the native
// <select>, so fireEvent.change no longer applies: the trigger opens on
// pointer interaction and items live in a portaled listbox. In jsdom
// fireEvent's PointerEvent carries no pointer type, so the sequence below
// (pointerDown + click on the trigger, click on the option) is the
// touch-path through the primitive and commits the selection.
export function selectRadixOption(trigger: HTMLElement, optionName: string | RegExp) {
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('option', { name: optionName }));
}
