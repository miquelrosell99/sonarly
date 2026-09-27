import { createElement, useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { cn } from '../../lib/cn.js';
import { AutocompleteInput, type AutocompleteField } from '../ui/AutocompleteInput.js';
import { chipShellClass, ChipMoveButtons, ChipRemoveButton } from './chipBits.js';
import type { DndChipRowProps } from './PillDnd.js';

export interface SortablePillInputProps {
  id?: string;
  values: string[];
  onChange: (values: string[]) => void;
  autocomplete?: AutocompleteField;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Multi-value tag field (song artists, genres, album artists) whose chips
 * can be reordered — the array order is what the tags endpoint persists
 * (the server writes junction `position` from the slice order).
 *
 * Reorder paths, all reporting through onChange:
 * - pointer: drag a chip by its handle (available once the lazy dnd-kit
 *   wrapper has loaded);
 * - keyboard: focus a handle, press Enter/Space to lift, arrow keys to move,
 *   Enter/Space to drop (dnd-kit KeyboardSensor) — or the chips' always
 *   present move-left/move-right buttons, which work even before the wrapper
 *   loads.
 *
 * The dnd-kit wrapper (`PillDnd`) dynamic-imports when the editor renders,
 * keeping @dnd-kit out of the edit chunk's static graph. Chips and the text
 * input render synchronously and never remount when the wrapper arrives, so
 * in-progress typing and focus survive the upgrade.
 */
export function SortablePillInput({
  id,
  values,
  onChange,
  autocomplete,
  placeholder,
  disabled,
  className,
}: SortablePillInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rawInput, setRawInput] = useState('');
  const [dndRow, setDndRow] = useState<ComponentType<DndChipRowProps> | null>(null);

  useEffect(() => {
    let alive = true;
    import('./PillDnd.js')
      .then((module) => {
        if (alive) setDndRow(() => module.DndChipRow);
      })
      .catch(() => {
        // dnd-kit failed to load: the move buttons remain fully usable.
      });
    return () => {
      alive = false;
    };
  }, []);

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

  const moveValue = useCallback(
    (index: number, delta: -1 | 1) => {
      const target = index + delta;
      if (target < 0 || target >= values.length) return;
      const next = [...values];
      [next[index], next[target]] = [next[target], next[index]];
      onChange(next);
    },
    [values, onChange],
  );

  const dragReorder = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      const next = [...values];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      onChange(next);
    },
    [values, onChange],
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
      role="group"
      aria-label={placeholder ?? 'Values'}
    >
      {dndRow
        ? createElement(dndRow, {
            values,
            disabled,
            onMove: moveValue,
            onRemove: removeValue,
            onDragReorder: dragReorder,
          })
        : values.map((value, index) => (
          <span key={value} className={chipShellClass(Boolean(disabled))}>
            <span className="max-w-44 truncate">{value}</span>
            {!disabled && (
              <>
                <ChipMoveButtons value={value} index={index} total={values.length} onMove={(delta) => moveValue(index, delta)} />
                <ChipRemoveButton value={value} onRemove={() => removeValue(index)} />
              </>
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
