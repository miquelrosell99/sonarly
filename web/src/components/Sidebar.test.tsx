import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Playlist, User } from '../types';
import { Sidebar } from './Sidebar.js';

vi.mock('../hooks/usePreferences.js', () => ({
  usePreferences: () => ({ data: undefined }),
  useUpdatePreferences: () => ({ mutate: vi.fn() }),
}));

vi.mock('../hooks/useLibraryLists.js', () => ({
  useLibraries: () => ({ data: { libraries: [] }, error: null }),
}));

// Layout-only harness: the real rows pull in context menus, share modals and
// notifications; the assertions here target the sidebar chrome classes.
vi.mock('./SidebarPlaylistItem.js', () => ({
  SidebarPlaylistItem: ({ playlist }: { playlist: Playlist }) => (
    <div data-testid={`row-${playlist.id}`} />
  ),
}));

vi.mock('./LibrarySelector.js', () => ({
  LibrarySelector: () => <div />,
}));

const user: User = {
  id: 'u1',
  username: 'admin',
  isAdmin: true,
  createdAt: '2024-01-01T00:00:00.000Z',
};

function makePlaylist(id: string): Playlist {
  return {
    id,
    name: `Playlist ${id}`,
    ownerId: user.id,
    ownerUsername: user.username,
    visibility: 'private',
    resolveMode: 'tracks',
    songCount: 0,
    starred: false,
    isSmart: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function renderSidebar(playlists?: Playlist[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Sidebar config={undefined} playlists={playlists} user={user} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.pushState({}, '', '/');
});

describe('Sidebar atomic playlists scroll', () => {
  it('makes the playlists list the only scroll region (overscroll-contained)', () => {
    const { container } = renderSidebar([makePlaylist('p1'), makePlaylist('p2')]);

    const navs = container.querySelectorAll('nav');
    expect(navs.length).toBe(2);
    const [linksNav, playlistsNav] = navs;

    // Library links are flex-none chrome: no independent wheel capture.
    expect(linksNav.className).toContain('shrink-0');
    expect(linksNav.className).not.toContain('overflow-y-auto');
    expect(linksNav.className).not.toContain('flex-1');
    expect(linksNav.className).not.toContain('overscroll-contain');

    // The playlists nav absorbs the sidebar's free space and holds the wheel
    // until its own end.
    expect(playlistsNav.className).toContain('flex-1');
    expect(playlistsNav.className).toContain('min-h-0');
    expect(playlistsNav.className).toContain('overflow-y-auto');
    expect(playlistsNav.className).toContain('overscroll-contain');
  });

  it('pins the playlists section header above the scroll region', () => {
    const { container } = renderSidebar([makePlaylist('p1')]);

    const playlistsNav = container.querySelectorAll('nav')[1];
    const section = playlistsNav.parentElement!;
    const header = section.firstElementChild as HTMLElement;

    expect(section.className).toContain('flex-1');
    expect(section.className).toContain('min-h-0');
    expect(header.className).toContain('shrink-0');
    expect(header.textContent).toContain('Playlists');
  });

  it('collapses naturally on short lists — no forced height', () => {
    const { container } = renderSidebar([makePlaylist('p1')]);

    const playlistsNav = container.querySelectorAll('nav')[1];
    // min-h-0 (shrink allowed), no fixed min-height utility.
    expect(playlistsNav.className).toContain('min-h-0');
    expect(playlistsNav.className).not.toMatch(/min-h-(?!0\b)\S/);
    // The sidebar column itself is a full-height flex column.
    const aside = container.querySelector('aside')!;
    expect(aside.className).toContain('flex-col');
    const body = aside.firstElementChild as HTMLElement;
    expect(body.className).toContain('overflow-hidden');
    expect(body.className).toContain('flex-col');
  });
});
