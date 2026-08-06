import { useRef, useCallback, useState } from 'react';
import { cn } from '../../lib/cn.js';
import { AutocompleteInput } from './AutocompleteInput.js';
import { Icon } from './Icon.js';

interface PillInputProps {
  id?: string;
  values: string[];
  onChange: (values: string[]) => void;
  autocomplete?: 'artist' | 'album' | 'albumArtist' | 'genre';
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function PillInput({
  id,
  values,
  onChange,
  autocomplete,
  placeholder,
  disabled,
  className,
}: PillInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rawInput, setRawInput] = useState('');

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const addValue = useCallback(
    (raw: string, shouldFocus = true) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        if (shouldFocus) focusInput();
        return;
      }
      if (values.some((v) => v.toLowerCase() === trimmed.toLowerCase())) {
        if (shouldFocus) focusInput();
        return;
      }
      onChange([...values, trimmed]);
      setRawInput('');
      if (shouldFocus) {
        // Refocus after React renders the cleared input.
        requestAnimationFrame(focusInput);
      }
    },
    [values, onChange, focusInput],
  );

  const removeValue = useCallback(
    (index: number) => {
      onChange(values.filter((_, i) => i !== index));
      focusInput();
    },
    [values, onChange, focusInput],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace' && values.length > 0) {
        const input = e.currentTarget;
        if (input.selectionStart === 0 && input.selectionEnd === 0) {
          e.preventDefault();
          onChange(values.slice(0, -1));
        }
      } else if (e.key === 'Enter' && autocomplete === undefined) {
        e.preventDefault();
        addValue(rawInput);
      }
    },
    [values, onChange, autocomplete, rawInput, addValue],
  );

  return (
    <div
      className={cn(
        'input flex h-auto min-h-[2.5rem] flex-wrap items-center gap-1.5 px-2 py-1.5',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      onClick={focusInput}
      role="listbox"
      aria-label={placeholder ?? 'Values'}
    >
      {values.map((value, index) => (
        <span
          key={`${value}-${index}`}
          className="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2.5 py-0.5 text-sm text-fg-primary"
          role="option"
          aria-selected="true"
        >
          {value}
          {!disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeValue(index);
              }}
              aria-label={`Remove ${value}`}
              title={`Remove ${value}`}
              className="ml-0.5 rounded-full p-0.5 text-fg-secondary transition hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Icon name="mdi-close" size={14} />
            </button>
          )}
        </span>
      ))}
      {autocomplete ? (
        <AutocompleteInput
          id={id}
          field={autocomplete}
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          onValueSelect={(value) => addValue(value, false)}
          onKeyDown={disabled ? undefined : handleKeyDown}
          placeholder={values.length === 0 ? placeholder : undefined}
          disabled={disabled}
          className="min-w-[6rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm focus-visible:ring-0 h-auto"
          ref={inputRef}
        />
      ) : (
        <input
          id={id}
          ref={inputRef}
          type="text"
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
          onKeyDown={disabled ? undefined : handleKeyDown}
          placeholder={values.length === 0 ? placeholder : undefined}
          disabled={disabled}
          className="min-w-[6rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm focus-visible:outline-none"
        />
      )}
    </div>
  );
}
