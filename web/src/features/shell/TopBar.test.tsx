import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
import { usePlayers, playersPollInterval } from './TopBar.js';

// FF6: capture the options handed to useQuery so we can assert the polling
// contract without timers.
let capturedOptions: Record<string, unknown> | undefined;

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: (options: Record<string, unknown>) => {
      capturedOptions = options;
      return { data: [] };
    },
  };
});

afterEach(() => {
  cleanup();
  capturedOptions = undefined;
});

function Harness() {
  usePlayers('me');
  return React.createElement('div');
}

describe('usePlayers polling (FF6)', () => {
  it('passes the query key and disables background refetch', () => {
    render(React.createElement(Harness));
    expect(capturedOptions?.queryKey).toEqual(['players']);
    expect(capturedOptions?.refetchIntervalInBackground).toBe(false);
    expect(typeof capturedOptions?.refetchInterval).toBe('function');
  });

  it('polls only while other players exist', () => {
    render(React.createElement(Harness));
    const interval = capturedOptions!.refetchInterval as (
      query: { state: { data?: { players: { userId: string }[] } } },
    ) => number | false;

    // No data yet (first load in flight): no interval.
    expect(interval({ state: { data: undefined } })).toBe(false);
    // Only the current user's player: the dropdown renders nothing, stop polling.
    expect(interval({ state: { data: { players: [{ userId: 'me' }] } } })).toBe(false);
    // Another user's player is present: the indicator is mounted, poll every 5s.
    expect(interval({ state: { data: { players: [{ userId: 'me' }, { userId: 'other' }] } } })).toBe(5000);
  });

  it('playersPollInterval is the pure gating predicate', () => {
    expect(playersPollInterval(undefined, 'me')).toBe(false);
    expect(playersPollInterval({ players: [] }, 'me')).toBe(false);
    expect(playersPollInterval({ players: [{ userId: 'other' } as never] }, 'me')).toBe(5000);
  });
});
