import { useEffect, useRef, useState, useCallback, forwardRef } from 'react';
import { api } from '../../api.js';
import { cn } from '../../lib/cn.js';

interface AutocompleteInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  field: 'artist' | 'album' | 'genre' | 'albumArtist';
  delay?: number;
  defaultLimit?: number;
  onValueSelect?: (value: string) => void;
}

export const AutocompleteInput = forwardRef<HTMLInputElement, AutocompleteInputProps>(function AutocompleteInput(
  {
    field,
    delay = 200,
    defaultLimit = 5,
    className,
    onChange,
    onValueSelect,
    onBlur,
    onFocus,
    value,
    ...props
  },
  ref,
) {
  const [query, setQuery] = useState(String(value ?? ''));
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoreBlurRef = useRef(false);
  const initialFetchRef = useRef(false);

  useEffect(() => {
    setQuery(String(value ?? ''));
  }, [value]);

  const fetchSuggestions = useCallback(
    async (input: string, limit: number) => {
      setLoading(true);
      try {
        const res = await api<{ suggestions: string[] }>(
          `/suggestions?field=${field}&q=${encodeURIComponent(input)}&limit=${limit}`,
        );
        setSuggestions(res.suggestions);
        setHighlighted(0);
        setOpen(true);
      } catch {
        setSuggestions([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    },
    [field],
  );

  const hasExactMatch = suggestions.some(
    (s) => s.toLowerCase() === query.trim().toLowerCase(),
  );
  const createOption = query.trim() && !hasExactMatch ? `Create "${query.trim()}"` : null;
  const options = createOption ? [createOption, ...suggestions] : suggestions;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setQuery(newValue);
    onChange?.(e);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(newValue, defaultLimit);
    }, delay);
  };

  const selectOption = (option: string) => {
    const isCreate = option === createOption;
    const newValue = isCreate ? query.trim() : option;
    const syntheticEvent = {
      target: { value: newValue },
      currentTarget: { value: newValue },
    } as React.ChangeEvent<HTMLInputElement>;
    setQuery(newValue);
    setOpen(false);
    setSuggestions([]);
    onChange?.(syntheticEvent);
    onValueSelect?.(newValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      props.onKeyDown?.(e);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((prev) => (prev + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((prev) => (prev - 1 + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (options.length > 0) {
        selectOption(options[highlighted]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      props.onKeyDown?.(e);
    } else {
      props.onKeyDown?.(e);
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (!initialFetchRef.current) {
      initialFetchRef.current = true;
      fetchSuggestions('', defaultLimit);
    } else {
      setOpen(options.length > 0);
    }
    onFocus?.(e);
  };

  return (
    <div className="relative">
      <input
        {...props}
        ref={ref}
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={(e) => {
          if (ignoreBlurRef.current) return;
          setTimeout(() => setOpen(false), 150);
          onBlur?.(e);
        }}
        className={cn('input', className)}
      />
      {open && (
        <ul
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-rule bg-surface shadow-lg"
          onMouseDown={() => {
            ignoreBlurRef.current = true;
          }}
          onMouseUp={() => {
            ignoreBlurRef.current = false;
          }}
        >
          {options.length === 0 && !loading && (
            <li className="px-3 py-2 text-sm text-fg-secondary">No matches</li>
          )}
          {options.map((option, i) => {
            const isCreateOption = option === createOption;
            return (
              <li
                key={option}
                onClick={() => selectOption(option)}
                className={cn(
                  'cursor-pointer px-3 py-2 text-sm hover:bg-surface-hover',
                  i === highlighted && 'bg-surface-hover',
                  isCreateOption && 'font-medium text-accent',
                )}
              >
                {isCreateOption ? option : option}
              </li>
            );
          })}
        </ul>
      )}
      {loading && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">...</span>
      )}
    </div>
  );
});
