import { useEffect, useRef, useState } from 'react';
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

interface ResultGroup<T> {
  label: string;
  items: T[];
  href: (item: T) => string;
  render: (item: T) => string;
}

export function SearchBox() {
  const [, setLocation] = useLocation();
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(inputValue, 200);
  const { data } = useSearch(debouncedQuery);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

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
    setLocation(href);
    inputRef.current?.blur();
  };

  const groups: ResultGroup<unknown>[] = [];

  if (data) {
    if (data.songs.length > 0) {
      groups.push({
        label: 'Songs',
        items: data.songs,
        href: (item) => `/tracks/${(item as Song).id}`,
        render: (item) => (item as Song).title,
      });
    }
    if (data.albums.length > 0) {
      groups.push({
        label: 'Albums',
        items: data.albums,
        href: (item) => `/albums/${(item as Album).id}`,
        render: (item) => (item as Album).name,
      });
    }
    if (data.artists.length > 0) {
      groups.push({
        label: 'Artists',
        items: data.artists,
        href: (item) => `/artists/${(item as Artist).id}`,
        render: (item) => (item as Artist).name,
      });
    }
    if (data.playlists.length > 0) {
      groups.push({
        label: 'Playlists',
        items: data.playlists,
        href: (item) => `/playlists/${(item as Playlist).id}`,
        render: (item) => (item as Playlist).name,
      });
    }
  }

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
          {groups.length === 0 ? (
            <p className="px-4 py-2 text-sm text-muted">No results found.</p>
          ) : (
            groups.map((group) => (
              <div key={group.label} role="group" aria-label={group.label}>
                <p className="px-4 py-1 text-xs font-semibold uppercase tracking-wider text-muted">
                  {group.label}
                </p>
                <ul>
                  {group.items.map((item, index) => {
                    const href = group.href(item);
                    return (
                      <li key={index}>
                        <button
                          type="button"
                          onClick={() => navigate(href)}
                          className="w-full px-4 py-2 text-left text-sm text-fg-primary transition hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
                          role="option"
                        >
                          {group.render(item)}
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
