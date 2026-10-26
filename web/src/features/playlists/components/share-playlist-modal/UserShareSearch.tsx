import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '../../../../lib/api.js';
import { cn } from '../../../../lib/cn.js';
import { Input } from '../../../../components/ui/input.js';
import { Icon } from '../../../../components/ui/Icon.js';
import type { LookupUser } from './types.js';

export function UserShareSearch({
  excludeIds,
  resetKey,
  onSelect,
}: {
  excludeIds: Set<string>;
  resetKey: number;
  onSelect: (user: LookupUser | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LookupUser[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoreBlurRef = useRef(false);
  const listboxId = useId();

  useEffect(() => {
    setQuery('');
    setResults([]);
    setOpen(false);
    onSelect(null);
  }, [resetKey, onSelect]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const fetchUsers = useCallback(
    async (input: string) => {
      setLoading(true);
      try {
        const res = await api<{ users: LookupUser[] }>(`/users/lookup?q=${encodeURIComponent(input)}`);
        setResults(res.users.filter((u) => !excludeIds.has(u.id)));
        setHighlighted(0);
        setOpen(true);
      } catch {
        setResults([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    },
    [excludeIds],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    onSelect(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchUsers(value), 200);
  };

  const selectUser = (user: LookupUser) => {
    setQuery(user.username);
    setOpen(false);
    setResults([]);
    onSelect(user);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length > 0) setHighlighted((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0) setHighlighted((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[highlighted]) selectUser(results[highlighted]);
    } else if (e.key === 'Escape') {
      // Keep the containing modal open; only dismiss the suggestion list.
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="relative flex-1">
      <Input
        type="text"
        role="combobox"
        variant="boxed"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && results.length > 0 ? `${listboxId}-option-${highlighted}` : undefined}
        aria-label="Search users"
        placeholder="Search users…"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(results.length > 0)}
        onBlur={() => {
          if (ignoreBlurRef.current) return;
          setTimeout(() => setOpen(false), 150);
        }}
        className="w-full"
      />
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Matching users"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-popover border border-outline bg-surface shadow-lg"
          onMouseDown={() => {
            ignoreBlurRef.current = true;
          }}
          onMouseUp={() => {
            ignoreBlurRef.current = false;
          }}
        >
          {results.length === 0 && !loading && (
            <li className="px-3 py-2 text-sm text-on-surface-variant">No matches</li>
          )}
          {results.map((user, i) => (
            <li
              key={user.id}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === highlighted}
              onClick={() => selectUser(user)}
              className={cn(
                'cursor-pointer px-3 py-2 text-sm hover:bg-surface-container-high',
                i === highlighted && 'bg-surface-container-high',
              )}
            >
              {user.username}
            </li>
          ))}
        </ul>
      )}
      {loading && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant">
          <Icon name="mdi-loading" size={16} className="animate-spin motion-reduce:animate-none" />
        </span>
      )}
    </div>
  );
}
