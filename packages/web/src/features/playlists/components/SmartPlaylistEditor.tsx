import { useState } from 'react';
import type { SmartPlaylistRule, SmartPlaylistRules, SmartPlaylistRuleGroup, SmartPlaylistSort } from '@sonarly/shared';
import { SMART_PLAYLIST_FIELDS } from '@sonarly/shared';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';

const OPERATORS: { value: SmartPlaylistRule['operator']; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'isNot', label: 'is not' },
  { value: 'contains', label: 'contains' },
  { value: 'notContains', label: 'does not contain' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'inTheRange', label: 'between' },
  { value: 'before', label: 'before' },
  { value: 'after', label: 'after' },
  { value: 'inTheLast', label: 'in the last (days)' },
  { value: 'notInTheLast', label: 'not in the last (days)' },
  { value: 'isMissing', label: 'is missing' },
  { value: 'isPresent', label: 'is present' },
];

function defaultRule(): SmartPlaylistRule {
  return { field: 'title', operator: 'contains', value: '' };
}

function emptyGroup(): SmartPlaylistRuleGroup {
  return { all: [defaultRule()] };
}

interface SmartPlaylistEditorProps {
  initialRules?: SmartPlaylistRules;
  onChange: (rules: SmartPlaylistRules) => void;
}

export function SmartPlaylistEditor({ initialRules, onChange }: SmartPlaylistEditorProps) {
  const [group, setGroup] = useState<SmartPlaylistRuleGroup>(initialRules?.rules ?? emptyGroup());
  const [sort, setSort] = useState<SmartPlaylistSort[]>(initialRules?.sort ?? []);
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

  const updateRule = (key: 'all' | 'any', index: number, patch: Partial<SmartPlaylistRule>) => {
    const list = [...(group[key] ?? [])];
    list[index] = { ...list[index], ...patch };
    update({ ...group, [key]: list }, sort, limit);
  };

  const removeRule = (key: 'all' | 'any', index: number) => {
    const list = [...(group[key] ?? [])];
    list.splice(index, 1);
    update({ ...group, [key]: list }, sort, limit);
  };

  const addRule = (key: 'all' | 'any') => {
    const list = [...(group[key] ?? []), defaultRule()];
    update({ ...group, [key]: list }, sort, limit);
  };

  const toggleGroup = () => {
    if (group.all && group.all.length > 0 && (!group.any || group.any.length === 0)) {
      update({ any: group.all }, sort, limit);
    } else {
      update({ all: group.any ?? [defaultRule()] }, sort, limit);
    }
  };

  const updateSortField = (index: number, field: string) => {
    const next = [...sort];
    next[index] = { field, direction: 'asc' };
    update(group, next, limit);
  };

  const updateSortDirection = (index: number, direction: 'asc' | 'desc') => {
    const next = [...sort];
    next[index] = { ...next[index], field: (next[index] as { field: string; direction: 'asc' | 'desc' }).field, direction };
    update(group, next, limit);
  };

  const addSort = () => update(group, [...sort, { field: 'title', direction: 'asc' }], limit);
  const removeSort = (index: number) => {
    const next = [...sort];
    next.splice(index, 1);
    update(group, next, limit);
  };

  const activeKey: 'all' | 'any' = group.all && group.all.length > 0 ? 'all' : 'any';
  const rulesList = activeKey === 'all' ? group.all ?? [] : group.any ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Match</span>
        <button
          type="button"
          onClick={toggleGroup}
          className="rounded bg-gray-100 px-2 py-1 text-xs font-medium hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"
        >
          {activeKey === 'all' ? 'ALL' : 'ANY'}
        </button>
        <span className="text-sm text-gray-500">of the following rules</span>
      </div>

      <div className="space-y-2">
        {rulesList.map((rule, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2 rounded border border-gray-200 p-2 dark:border-gray-700">
            <select
              value={rule.field}
              onChange={(e) => updateRule(activeKey, index, { field: e.target.value })}
              className="input py-1 text-sm"
            >
              {SMART_PLAYLIST_FIELDS.map((f) => (
                <option key={f.field} value={f.field}>{f.label}</option>
              ))}
            </select>
            <select
              value={rule.operator}
              onChange={(e) => updateRule(activeKey, index, { operator: e.target.value as SmartPlaylistRule['operator'] })}
              className="input py-1 text-sm"
            >
              {OPERATORS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {rule.operator !== 'isMissing' && rule.operator !== 'isPresent' && (
              <Input
                value={rule.value === undefined ? '' : String(rule.value)}
                onChange={(e) => updateRule(activeKey, index, { value: e.target.value })}
                placeholder={rule.operator === 'inTheRange' ? 'min,max' : 'value'}
                className="flex-1 py-1 text-sm"
              />
            )}
            <Button variant="ghost" onClick={() => removeRule(activeKey, index)} className="text-danger">
              Remove
            </Button>
          </div>
        ))}
        <Button variant="ghost" onClick={() => addRule(activeKey)}>
          + Add rule
        </Button>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Sort</span>
          <Button variant="ghost" onClick={addSort}>+ Add sort</Button>
        </div>
        <div className="space-y-2">
          {sort.map((s, index) => {
            if ('random' in s) {
              return (
                <div key={index} className="flex items-center gap-2 text-sm">
                  <span>Random</span>
                  <Button variant="ghost" onClick={() => removeSort(index)}>Remove</Button>
                </div>
              );
            }
            const sortItem = s as { field: string; direction: 'asc' | 'desc' };
            return (
              <div key={index} className="flex items-center gap-2">
                <select
                  value={sortItem.field}
                  onChange={(e) => updateSortField(index, e.target.value)}
                  className="input py-1 text-sm"
                >
                  {SMART_PLAYLIST_FIELDS.map((f) => (
                    <option key={f.field} value={f.field}>{f.label}</option>
                  ))}
                </select>
                <select
                  value={sortItem.direction}
                  onChange={(e) => updateSortDirection(index, e.target.value as 'asc' | 'desc')}
                  className="input py-1 text-sm"
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
                <Button variant="ghost" onClick={() => removeSort(index)}>Remove</Button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Limit</span>
        <Input
          type="number"
          min={1}
          value={limit}
          onChange={(e) => update(group, sort, e.target.value)}
          placeholder="unlimited"
          className="w-32 py-1 text-sm"
        />
      </div>
    </div>
  );
}
