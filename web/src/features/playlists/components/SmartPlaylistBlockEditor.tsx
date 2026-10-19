import { useState } from 'react';
import type { SmartPlaylistRule, SmartPlaylistRules, SmartPlaylistRuleGroup, SmartPlaylistSort, SmartPlaylistFieldType } from '../../../types';
import { SMART_PLAYLIST_FIELDS } from '../../../types';
import { cn } from '../../../lib/cn.js';
import { Button } from '../../../components/ui/button.js';
import { Input } from '../../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.js';
import { Icon } from '../../../components/ui/Icon.js';
import { AutocompleteInput } from '../../../components/ui/AutocompleteInput.js';

const STRING_OPERATORS: { value: SmartPlaylistRule['operator']; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'isNot', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'notContains', label: 'does not contain' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'isMissing', label: 'is missing' },
  { value: 'isPresent', label: 'is present' },
];

const NUMBER_OPERATORS: { value: SmartPlaylistRule['operator']; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'isNot', label: 'is not' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'greater than or equal to' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'less than or equal to' },
  { value: 'inTheRange', label: 'between' },
  { value: 'isMissing', label: 'is missing' },
  { value: 'isPresent', label: 'is present' },
];

const DATE_OPERATORS: { value: SmartPlaylistRule['operator']; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'isNot', label: 'is not' },
  { value: 'gt', label: 'after' },
  { value: 'lt', label: 'before' },
  { value: 'inTheRange', label: 'between' },
  { value: 'inTheLast', label: 'in the last (days)' },
  { value: 'notInTheLast', label: 'not in the last (days)' },
  { value: 'isMissing', label: 'is missing' },
  { value: 'isPresent', label: 'is present' },
];

const BOOLEAN_OPERATORS: { value: SmartPlaylistRule['operator']; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'isNot', label: 'is not' },
  { value: 'isMissing', label: 'is missing' },
  { value: 'isPresent', label: 'is present' },
];

function operatorsForType(type: SmartPlaylistFieldType): { value: SmartPlaylistRule['operator']; label: string }[] {
  switch (type) {
    case 'boolean':
      return BOOLEAN_OPERATORS;
    case 'number':
      return NUMBER_OPERATORS;
    case 'date':
      return DATE_OPERATORS;
    case 'string':
    default:
      return STRING_OPERATORS;
  }
}

function defaultValueForType(type: SmartPlaylistFieldType): string | number | boolean {
  switch (type) {
    case 'boolean':
      return true;
    case 'number':
      return 0;
    case 'date':
      return '';
    case 'string':
    default:
      return '';
  }
}

function defaultOperatorForType(type: SmartPlaylistFieldType): SmartPlaylistRule['operator'] {
  switch (type) {
    case 'boolean':
      return 'is';
    case 'number':
      return 'gt';
    case 'date':
      return 'inTheLast';
    case 'string':
    default:
      return 'contains';
  }
}

function getFieldType(field: string): SmartPlaylistFieldType {
  return SMART_PLAYLIST_FIELDS.find((f) => f.field === field)?.type ?? 'string';
}

function isAutocompleteField(field: string): field is 'artist' | 'album' | 'albumArtist' | 'genre' | 'releaseType' {
  return field === 'artist' || field === 'album' || field === 'albumArtist' || field === 'genre' || field === 'releaseType';
}

function defaultRule(): SmartPlaylistRule {
  return { field: 'title', operator: 'contains', value: '' };
}

function defaultSort(): SmartPlaylistSort {
  return { field: 'title', direction: 'asc' };
}

function emptyGroup(): SmartPlaylistRuleGroup {
  return { all: [defaultRule()] };
}

function ensureDefaultSort(sort: SmartPlaylistSort[] | undefined): SmartPlaylistSort[] {
  return sort && sort.length > 0 ? sort : [defaultSort()];
}

interface SmartPlaylistBlockEditorProps {
  initialRules?: SmartPlaylistRules;
  onChange: (rules: SmartPlaylistRules) => void;
}

export function SmartPlaylistBlockEditor({ initialRules, onChange }: SmartPlaylistBlockEditorProps) {
  const [group, setGroup] = useState<SmartPlaylistRuleGroup>(initialRules?.rules ?? emptyGroup());
  const [sort, setSort] = useState<SmartPlaylistSort[]>(() => ensureDefaultSort(initialRules?.sort));
  const [limit, setLimit] = useState<string>(initialRules?.limit?.toString() ?? '');

  const update = (nextGroup: SmartPlaylistRuleGroup, nextSort: SmartPlaylistSort[], nextLimit: string) => {
    setGroup(nextGroup);
    setSort(nextSort);
    setLimit(nextLimit);
    const rules: SmartPlaylistRules = { rules: nextGroup, sort: nextSort };
    const parsedLimit = parseInt(nextLimit, 10);
    if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
      rules.limit = parsedLimit;
    }
    onChange(rules);
  };

  const activeKey: 'all' | 'any' = group.all && group.all.length > 0 ? 'all' : 'any';
  const rulesList = activeKey === 'all' ? group.all ?? [] : group.any ?? [];

  const updateRuleList = (nextRules: SmartPlaylistRule[]) => {
    update({ ...group, [activeKey]: nextRules }, sort, limit);
  };

  const updateRule = (index: number, patch: Partial<SmartPlaylistRule>) => {
    const list = [...rulesList];
    list[index] = { ...list[index], ...patch };
    updateRuleList(list);
  };

  const updateRuleField = (index: number, field: string) => {
    const type = getFieldType(field);
    const operator = defaultOperatorForType(type);
    const value = defaultValueForType(type);
    updateRule(index, { field, operator, value });
  };

  const removeRule = (index: number) => {
    const list = [...rulesList];
    list.splice(index, 1);
    updateRuleList(list);
  };

  const addRule = () => {
    updateRuleList([...rulesList, defaultRule()]);
  };

  const moveRule = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= rulesList.length) return;
    const next = [...rulesList];
    [next[index], next[newIndex]] = [next[newIndex], next[index]];
    updateRuleList(next);
  };

  const toggleMatchType = () => {
    if (activeKey === 'all') {
      update({ any: rulesList }, sort, limit);
    } else {
      update({ all: rulesList }, sort, limit);
    }
  };

  const addSort = () => update(group, [...sort, defaultSort()], limit);

  const updateSortList = (nextSort: SmartPlaylistSort[]) => {
    update(group, ensureDefaultSort(nextSort), limit);
  };

  const removeSort = (index: number) => {
    const next = [...sort];
    next.splice(index, 1);
    updateSortList(next);
  };

  const moveSort = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= sort.length) return;
    const next = [...sort];
    [next[index], next[newIndex]] = [next[newIndex], next[index]];
    updateSortList(next);
  };

  const updateSortField = (index: number, field: string) => {
    const next = [...sort];
    next[index] = { field, direction: 'asc' };
    updateSortList(next);
  };

  const updateSortDirection = (index: number, direction: 'asc' | 'desc' | 'random') => {
    const next = [...sort];
    if (direction === 'random') {
      next[index] = { random: true };
    } else {
      const current = next[index];
      if (current && !('random' in current)) {
        next[index] = { ...current, direction };
      } else {
        next[index] = { field: 'title', direction };
      }
    }
    updateSortList(next);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-outline bg-surface p-4">
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="font-medium text-on-surface">Match</span>
          <div className="inline-flex rounded-item border border-outline bg-background p-0.5">
            <button
              type="button"
              onClick={() => activeKey === 'any' && toggleMatchType()}
              className={cn(
                'rounded-item px-2.5 py-1 text-xs font-medium transition',
                activeKey === 'all'
                  ? 'bg-primary text-on-primary'
                  : 'text-on-surface-variant hover:text-on-surface',
              )}
            >
              ALL
            </button>
            <button
              type="button"
              onClick={() => activeKey === 'all' && toggleMatchType()}
              className={cn(
                'rounded-item px-2.5 py-1 text-xs font-medium transition',
                activeKey === 'any'
                  ? 'bg-primary text-on-primary'
                  : 'text-on-surface-variant hover:text-on-surface',
              )}
            >
              ANY
            </button>
          </div>
          <span className="text-on-surface-variant">of the following rules</span>
        </div>

        <div className="space-y-2">
          {rulesList.map((rule, index) => (
            <RuleBlock
              key={index}
              rule={rule}
              onFieldChange={(field) => updateRuleField(index, field)}
              onOperatorChange={(operator) => updateRule(index, { operator })}
              onValueChange={(value) => updateRule(index, { value })}
              onRemove={() => removeRule(index)}
              onMoveUp={() => moveRule(index, -1)}
              onMoveDown={() => moveRule(index, 1)}
              canMoveUp={index > 0}
              canMoveDown={index < rulesList.length - 1}
            />
          ))}
        </div>

        <Button variant="ghost" onClick={addRule} className="mt-3 text-sm">
          <Icon name="mdi-plus" size={16} className="mr-1" />
          Add rule
        </Button>
      </div>

      <div className="rounded-card border border-outline bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-on-surface">Sort</span>
          <Button variant="ghost" onClick={addSort} className="text-sm">
            <Icon name="mdi-plus" size={16} className="mr-1" />
            Add sort
          </Button>
        </div>
        <div className="space-y-2">
          {sort.map((s, index) => (
            <SortBlock
              key={index}
              sort={s}
              onFieldChange={(field) => updateSortField(index, field)}
              onDirectionChange={(direction) => updateSortDirection(index, direction)}
              onRemove={() => removeSort(index)}
              onMoveUp={() => moveSort(index, -1)}
              onMoveDown={() => moveSort(index, 1)}
              canMoveUp={index > 0}
              canMoveDown={index < sort.length - 1}
            />
          ))}
        </div>
      </div>

      <div className="rounded-card border border-outline bg-surface p-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-on-surface">Limit</span>
          <Input
            type="number"
            min={1}
            value={limit}
            onChange={(e) => update(group, sort, e.target.value)}
            placeholder="unlimited"
            className="w-32 py-1.5 text-sm"
          />
          <span className="text-xs text-on-surface-variant">Maximum number of songs</span>
        </div>
      </div>
    </div>
  );
}

function RuleBlock({
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
          className="rounded-item p-1 text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Icon name="mdi-chevron-up" size={18} />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          aria-label="Move rule down"
          title="Move rule down"
          className="rounded-item p-1 text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Icon name="mdi-chevron-down" size={18} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove rule"
          title="Remove rule"
          className="rounded-item p-1 text-on-surface-variant transition hover:bg-surface-container-high hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Icon name="mdi-delete" size={18} />
        </button>
      </div>
    </div>
  );
}

function RuleValueInput({
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

function SortBlock({
  sort,
  onFieldChange,
  onDirectionChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  sort: SmartPlaylistSort;
  onFieldChange: (field: string) => void;
  onDirectionChange: (direction: 'asc' | 'desc' | 'random') => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const isRandom = 'random' in sort;
  const sortItem = isRandom ? null : (sort as { field: string; direction: 'asc' | 'desc' });

  return (
    <div className="flex items-center gap-2 rounded-item border border-outline bg-background p-3">
      <Select
        value={sortItem?.field ?? 'title'}
        onValueChange={onFieldChange}
        disabled={isRandom}
      >
        <SelectTrigger aria-label="Sort field" className={cn(isRandom && 'opacity-50')}>
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
        value={isRandom ? 'random' : sortItem?.direction}
        onValueChange={(value) => onDirectionChange(value as 'asc' | 'desc' | 'random')}
      >
        <SelectTrigger aria-label="Sort direction">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="asc">Ascending</SelectItem>
          <SelectItem value="desc">Descending</SelectItem>
          <SelectItem value="random">Random</SelectItem>
        </SelectContent>
      </Select>
      <div className="ml-auto flex items-center gap-0.5">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={!canMoveUp}
          aria-label="Move sort up"
          title="Move sort up"
          className="rounded-item p-1 text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Icon name="mdi-chevron-up" size={18} />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={!canMoveDown}
          aria-label="Move sort down"
          title="Move sort down"
          className="rounded-item p-1 text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Icon name="mdi-chevron-down" size={18} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove sort"
          title="Remove sort"
          className="rounded-item p-1 text-on-surface-variant transition hover:bg-surface-container-high hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Icon name="mdi-delete" size={18} />
        </button>
      </div>
    </div>
  );
}
