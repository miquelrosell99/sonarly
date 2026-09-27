import { cn } from '../../lib/cn.js';
import { Input } from '../ui/Input.js';
import { AutocompleteInput, type AutocompleteField } from '../ui/AutocompleteInput.js';

export function TagInput({
  id,
  value,
  onChange,
  type,
  autocomplete,
  placeholder,
  disabled,
  locked,
  hint,
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'number';
  autocomplete?: AutocompleteField;
  placeholder?: string;
  disabled?: boolean;
  locked?: boolean;
  hint?: string;
  className?: string;
}) {
  const lockedClass = locked ? 'border-transparent bg-transparent text-fg-primary cursor-default' : '';
  const input = autocomplete ? (
    <AutocompleteInput
      id={id}
      field={autocomplete}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={cn(lockedClass, className)}
    />
  ) : (
    <Input
      id={id}
      type={type ?? 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={cn(lockedClass, className)}
    />
  );

  if (!hint) return input;
  return (
    <div className="space-y-1">
      {input}
      <p className="text-xs text-fg-secondary">{hint}</p>
    </div>
  );
}
