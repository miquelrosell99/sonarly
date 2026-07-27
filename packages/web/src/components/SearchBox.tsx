import { useEffect, useRef, useState, useMemo } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import type { Song, Album, Artist, Playlist } from '@sonarly/shared';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import { api } from '../api.js';
import { FilterPanel, type FilterDefinition } from './FilterPanel.js';

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
    queryFn: () => api(`/search?q=${encodeURIComponent(query)}&limit=5`),
    enabled: query.length > 0,
    staleTime: 60_000,
  });
}

interface ResultItem {
  id: string;
  href: string;
  label: string;
  groupLabel: string;
  isMore?: boolean;
}

const PREVIEW_LIMIT = 5;

interface SearchBoxProps {
  filters?: FilterDefinition[];
  filtersOpen?: boolean;
  onToggleFilters?: () => void;
}

export function SearchBox({ filters, filtersOpen = false, onToggleFilters }: SearchBoxProps) {
  const [, setLocation] = useLocation();
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const hasFilters = filters && filters.length > 0;
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(inputValue, 200);
  const { data } = useSearch(debouncedQuery);

  const items = useMemo<ResultItem[]>(() => {
    if (!data) return [];
    const next: ResultItem[] = [];

    function addCategory<T extends { id: string }>(
      items: T[],
      label: string,
      typeKey: string,
      getLabel: (item: T) => string,
      getHref: (item: T) => string,
    ) {
      const prefix = typeKey.slice(0, -1);
      items.slice(0, PREVIEW_LIMIT).forEach((item) => {
        next.push({
          id: `${prefix}-${item.id}`,
          href: getHref(item),
          label: getLabel(item),
          groupLabel: label,
        });
      });
      if (items.length > PREVIEW_LIMIT) {
        next.push({
          id: `more-${typeKey}`,
          href: `/search?q=${encodeURIComponent(debouncedQuery)}&type=${typeKey}`,
          label: `More ${label.toLowerCase()}`,
          groupLabel: label,
          isMore: true,
        });
      }
    }

    addCategory(data.songs, 'Songs', 'songs', (song) => song.title, (song) => `/tracks/${song.id}`);
    addCategory(data.albums, 'Albums', 'albums', (album) => album.name, (album) => `/albums/${album.id}`);
    addCategory(data.artists, 'Artists', 'artists', (artist) => artist.name, (artist) => `/artists/${artist.id}`);
    addCategory(data.playlists, 'Playlists', 'playlists', (playlist) => playlist.name, (playlist) => `/playlists/${playlist.id}`);

    return next;
  }, [data, debouncedQuery]);

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
    let startIndex = 0;
    return Array.from(map.entries()).map(([groupLabel, groupItems]) => {
      const groupStartIndex = startIndex;
      startIndex += groupItems.length;
      return { groupLabel, groupItems, startIndex: groupStartIndex };
    });
  }, [items]);

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
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
          className={cn('input w-full pl-9', hasFilters ? 'pr-10' : 'pr-9')}
          aria-label="Search"
          aria-expanded={isOpen || filtersOpen}
          aria-autocomplete="list"
          aria-activedescendant={highlightedIndex >= 0 ? items[highlightedIndex]?.id : undefined}
          role="combobox"
        />
        {hasFilters && onToggleFilters && (
          <button
            type="button"
            onClick={() => onToggleFilters()}
            aria-expanded={filtersOpen}
            aria-label={filtersOpen ? 'Hide filters' : 'Show filters'}
            title="Filters"
            className={cn(
              'absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              filtersOpen
                ? 'bg-surface-hover text-fg-primary'
                : 'text-muted hover:bg-surface-hover hover:text-fg-primary',
            )}
          >
            <Icon name="mdi-filter-variant" size={18} />
          </button>
        )}
        {!hasFilters && (
          <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-rule bg-surface px-1.5 py-0.5 text-[10px] text-muted sm:block">
            Ctrl+K
          </kbd>
        )}
      </div>

      {(isOpen || filtersOpen) && (
        <div
          className={cn(
            'absolute left-0 right-0 top-full z-50 mt-2 overflow-auto rounded-md border border-rule bg-bg-primary py-2 shadow-lg',
            filtersOpen ? 'max-h-[36rem]' : 'max-h-[24rem]',
          )}
          role="listbox"
        >
          {filtersOpen && hasFilters && (
            <div className="border-b border-rule px-4 pb-4 pt-2">
              <FilterPanel filters={filters} className="border-0 bg-transparent p-0 shadow-none" />
            </div>
          )}
          {items.length === 0 ? (
            debouncedQuery.length > 0 ? (
              <p className="px-4 py-2 text-sm text-muted">No results found.</p>
            ) : null
          ) : (
            grouped.map(({ groupLabel, groupItems, startIndex }) => (
              <div key={groupLabel} role="group" aria-label={groupLabel}>
                <p className="px-4 py-1 text-xs font-semibold uppercase tracking-wider text-muted">
                  {groupLabel}
                </p>
                <ul>
                  {groupItems.map((item, localIndex) => {
                    const index = startIndex + localIndex;
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
                            item.isMore
                              ? 'text-muted hover:bg-surface-hover hover:text-fg-primary'
                              : isHighlighted
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
