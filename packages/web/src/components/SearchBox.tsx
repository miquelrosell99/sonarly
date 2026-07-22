import { useEffect, useRef, useState, useMemo } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import type { Song, Album, Artist, Playlist } from '@sonarly/shared';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import { api } from '../api.js';

interface SearchResponse {
  songs: Song[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

function useSearch(query: string) {
  return useQuery<SearchResponse, Error>({
    queryKey: ['search', query],
    queryFn: () => api(`/search?q=${encodeURIComponent(query)}`),
    enabled: query.length > 0,
    staleTime: 60_000,
  });
}

interface ResultItem {
  id: string;
  href: string;
  label: string;
  groupLabel: string;
}

export function SearchBox() {
  const [, setLocation] = useLocation();
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(inputValue, 200);
  const { data } = useSearch(debouncedQuery);

  const items = useMemo<ResultItem[]>(() => {
    if (!data) return [];
    const next: ResultItem[] = [];
    data.songs.forEach((song) =>
      next.push({ id: `song-${song.id}`, href: `/tracks/${song.id}`, label: song.title, groupLabel: 'Songs' }),
    );
    data.albums.forEach((album) =>
      next.push({ id: `album-${album.id}`, href: `/albums/${album.id}`, label: album.name, groupLabel: 'Albums' }),
    );
    data.artists.forEach((artist) =>
      next.push({ id: `artist-${artist.id}`, href: `/artists/${artist.id}`, label: artist.name, groupLabel: 'Artists' }),
    );
    data.playlists.forEach((playlist) =>
      next.push({ id: `playlist-${playlist.id}`, href: `/playlists/${playlist.id}`, label: playlist.name, groupLabel: 'Playlists' }),
    );
    return next;
  }, [data]);

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [items]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }

      if (e.key === 'Escape') {
        setIsOpen(false);
        inputRef.current?.blur();
        return;
      }

      const inputFocused = document.activeElement === inputRef.current;
      const navigating = isOpen && items.length > 0;

      if (e.key === 'ArrowDown') {
        if (!navigating && !inputFocused) return;
        e.preventDefault();
        if (!isOpen && debouncedQuery.length > 0) {
          setIsOpen(true);
        }
        setHighlightedIndex((prev) => {
          const next = prev + 1;
          return next >= items.length ? 0 : next;
        });
        return;
      }

      if (e.key === 'ArrowUp') {
        if (!navigating && !inputFocused) return;
        e.preventDefault();
        setHighlightedIndex((prev) => {
          const next = prev - 1;
          return next < 0 ? items.length - 1 : next;
        });
        return;
      }

      if (e.key === 'Enter') {
        if (!navigating || highlightedIndex < 0 || highlightedIndex >= items.length) return;
        e.preventDefault();
        navigate(items[highlightedIndex].href);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, items, highlightedIndex, debouncedQuery.length]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  useEffect(() => {
    if (debouncedQuery.length > 0) {
      setIsOpen(true);
    }
  }, [debouncedQuery]);

  const navigate = (href: string) => {
    setIsOpen(false);
    setInputValue('');
    setHighlightedIndex(-1);
    setLocation(href);
    inputRef.current?.blur();
  };

  const grouped = useMemo(() => {
    const map = new Map<string, ResultItem[]>();
    items.forEach((item) => {
      const list = map.get(item.groupLabel) ?? [];
      list.push(item);
      map.set(item.groupLabel, list);
    });
    return map;
  }, [items]);

  let runningIndex = 0;

  return (
    <div ref={containerRef} className="relative w-full">
      <Icon name="mdi-magnify" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onFocus={() => {
          if (debouncedQuery.length > 0) setIsOpen(true);
        }}
        placeholder="Search…"
        className="input w-full pl-9"
        aria-label="Search"
        aria-expanded={isOpen}
        aria-autocomplete="list"
        aria-activedescendant={highlightedIndex >= 0 ? items[highlightedIndex]?.id : undefined}
        role="combobox"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-rule bg-surface px-1.5 py-0.5 text-[10px] text-muted sm:block">
        Ctrl+K
      </kbd>

      {isOpen && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[24rem] overflow-auto rounded-md border border-rule bg-bg-primary py-2 shadow-lg"
          role="listbox"
        >
          {items.length === 0 ? (
            <p className="px-4 py-2 text-sm text-muted">No results found.</p>
          ) : (
            Array.from(grouped.entries()).map(([groupLabel, groupItems]) => (
              <div key={groupLabel} role="group" aria-label={groupLabel}>
                <p className="px-4 py-1 text-xs font-semibold uppercase tracking-wider text-muted">
                  {groupLabel}
                </p>
                <ul>
                  {groupItems.map((item) => {
                    const index = runningIndex++;
                    const isHighlighted = index === highlightedIndex;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          id={item.id}
                          onClick={() => navigate(item.href)}
                          onMouseEnter={() => setHighlightedIndex(index)}
                          className={cn(
                            'w-full px-4 py-2 text-left text-sm transition focus-visible:outline-none',
                            isHighlighted
                              ? 'bg-surface-hover text-fg-primary'
                              : 'text-fg-primary hover:bg-surface-hover',
                          )}
                          role="option"
                          aria-selected={isHighlighted}
                        >
                          {item.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
