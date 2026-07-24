import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../../api.js';
import { cn } from '../../lib/cn.js';

interface AutocompleteInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  field: 'artist' | 'album' | 'genre' | 'albumArtist';
  delay?: number;
}

export function AutocompleteInput({
  field,
  delay = 200,
  className,
  onChange,
  onBlur,
  onFocus,
  value,
  ...props
}: AutocompleteInputProps) {
  const [query, setQuery] = useState(String(value ?? ''));
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoreBlurRef = useRef(false);

  useEffect(() => {
    setQuery(String(value ?? ''));
  }, [value]);

  const fetchSuggestions = useCallback(
    async (input: string) => {
      if (!input.trim()) {
        setSuggestions([]);
        setOpen(false);
        return;
      }
      setLoading(true);
      try {
        const res = await api<{ suggestions: string[] }>(`/suggestions?field=${field}&q=${encodeURIComponent(input)}&limit=10`);
        setSuggestions(res.suggestions);
        setHighlighted(0);
        setOpen(res.suggestions.length > 0);
      } catch {
        setSuggestions([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    },
    [field],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setQuery(newValue);
    onChange?.(e);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(newValue);
    }, delay);
  };

  const selectSuggestion = (suggestion: string) => {
    const syntheticEvent = {
      target: { value: suggestion },
      currentTarget: { value: suggestion },
    } as React.ChangeEvent<HTMLInputElement>;
    setQuery(suggestion);
    setOpen(false);
    onChange?.(syntheticEvent);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((prev) => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectSuggestion(suggestions[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        {...props}
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={(e) => {
          setOpen(suggestions.length > 0);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          if (ignoreBlurRef.current) return;
          setTimeout(() => setOpen(false), 150);
          onBlur?.(e);
        }}
        className={cn('input', className)}
      />
      {open && (
        <ul
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto border border-rule bg-surface shadow-lg"
          onMouseDown={() => {
            ignoreBlurRef.current = true;
          }}
          onMouseUp={() => {
            ignoreBlurRef.current = false;
          }}
        >
          {suggestions.map((s, i) => (
            <li
              key={s}
              onClick={() => selectSuggestion(s)}
              className={cn(
                'cursor-pointer px-3 py-2 text-sm hover:bg-surface-hover',
                i === highlighted && 'bg-surface-hover',
              )}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
      {loading && (
        <span className="pointer-events-none absolute right-3 top-1.5 text-xs text-muted">...</span>
      )}
    </div>
  );
}
