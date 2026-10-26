import type { SmartPlaylistFieldType, SmartPlaylistRule } from '../../../../types';
import { SMART_PLAYLIST_FIELDS } from '../../../../types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select.js';
import { Input } from '../../../../components/ui/input.js';
import { Icon } from '../../../../components/ui/Icon.js';
import { AutocompleteInput } from '../../../../components/ui/AutocompleteInput.js';
import { getFieldType, isAutocompleteField, operatorsForType } from './smartPlaylistModel.js';

export function RuleBlock({
  rule,
  onFieldChange,
  onOperatorChange,
  onValueChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  rule: SmartPlaylistRule;
  onFieldChange: (field: string) => void;
  onOperatorChange: (operator: SmartPlaylistRule['operator']) => void;
  onValueChange: (value: SmartPlaylistRule['value']) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const fieldType = getFieldType(rule.field);
  const operators = operatorsForType(fieldType);
  const showValue = rule.operator !== 'isMissing' && rule.operator !== 'isPresent';

  return (
    <div className="flex items-center gap-2 rounded-item border border-outline bg-background p-3">
      <Select value={rule.field} onValueChange={onFieldChange}>
        <SelectTrigger aria-label="Rule field" className="w-auto text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SMART_PLAYLIST_FIELDS.map((f) => (
            <SelectItem key={f.field} value={f.field}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={rule.operator}
        onValueChange={(value) => onOperatorChange(value as SmartPlaylistRule['operator'])}
      >
        <SelectTrigger aria-label="Rule operator" className="w-auto text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showValue && (
        <RuleValueInput
          field={rule.field}
          operator={rule.operator}
          fieldType={fieldType}
          value={rule.value}
          onChange={onValueChange}
        />
      )}
      <div className="ml-auto flex items-center gap-0.5">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          aria-label="Move rule up"
          title="Move rule up"
          className="rounded-full aspect-square p-1 leading-none text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Icon name="mdi-chevron-up" size={18} />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          aria-label="Move rule down"
          title="Move rule down"
          className="rounded-full aspect-square p-1 leading-none text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Icon name="mdi-chevron-down" size={18} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove rule"
          title="Remove rule"
          className="rounded-full aspect-square p-1 leading-none text-on-surface-variant transition hover:bg-surface-container-high hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Icon name="mdi-delete" size={18} />
        </button>
      </div>
    </div>
  );
}

export function RuleValueInput({
  field,
  operator,
  fieldType,
  value,
  onChange,
}: {
  field: string;
  operator: SmartPlaylistRule['operator'];
  fieldType: SmartPlaylistFieldType;
  value?: SmartPlaylistRule['value'];
  onChange: (value: SmartPlaylistRule['value']) => void;
}) {
  if (fieldType === 'boolean') {
    return (
      <Select
        value={value === true ? 'true' : 'false'}
        onValueChange={(next) => onChange(next === 'true')}
      >
        <SelectTrigger aria-label="Rule value" className="w-auto text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">True</SelectItem>
          <SelectItem value="false">False</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (field === 'rating') {
    return (
      /* Radix Select items can't carry an empty value, so "any rating" rides
         the '__any' sentinel and maps back to undefined. */
      <Select
        value={value === undefined ? '__any' : String(value)}
        onValueChange={(next) => {
          if (next === '__any') {
            onChange(undefined);
            return;
          }
          const parsed = parseFloat(next);
          onChange(Number.isNaN(parsed) ? undefined : parsed);
        }}
      >
        <SelectTrigger aria-label="Rule value" className="w-auto text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__any">Any rating</SelectItem>
          {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((r) => (
            <SelectItem key={r} value={String(r)}>
              {r} {r === 1 ? 'star' : 'stars'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (fieldType === 'number') {
    const isRange = operator === 'inTheRange';
    return (
      <Input
        type={isRange ? 'text' : 'number'}
        inputMode={isRange ? 'text' : 'decimal'}
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => {
          const trimmed = e.target.value.trim();
          if (trimmed === '') {
            onChange(undefined);
            return;
          }
          if (isRange) {
            onChange(trimmed);
            return;
          }
          const parsed = parseFloat(trimmed);
          onChange(Number.isNaN(parsed) ? trimmed : parsed);
        }}
        placeholder={isRange ? 'min,max' : 'value'}
        className="min-w-[20rem] flex-1 py-1.5 text-sm"
      />
    );
  }

  if (fieldType === 'date') {
    const isDays = operator === 'inTheLast' || operator === 'notInTheLast';
    const isRange = operator === 'inTheRange';
    return (
      <Input
        type={isDays ? 'number' : 'text'}
        inputMode={isDays ? 'numeric' : 'text'}
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => {
          const trimmed = e.target.value.trim();
          if (trimmed === '') {
            onChange(undefined);
            return;
          }
          if (isDays) {
            const parsed = parseInt(trimmed, 10);
            onChange(Number.isNaN(parsed) ? trimmed : parsed);
            return;
          }
          onChange(trimmed);
        }}
        placeholder={isDays ? 'days' : isRange ? 'date,date' : 'YYYY-MM-DD'}
        className="min-w-[20rem] flex-1 py-1.5 text-sm"
      />
    );
  }

  if (isAutocompleteField(field)) {
    return (
      <AutocompleteInput
        field={field}
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder="value"
        className="min-w-[20rem] flex-1 py-1.5 text-sm"
      />
    );
  }

  return (
    <Input
      value={value === undefined || value === null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
      placeholder="value"
      className="min-w-[20rem] flex-1 py-1.5 text-sm"
    />
  );
}
