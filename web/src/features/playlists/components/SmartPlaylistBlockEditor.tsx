import type { SmartPlaylistRules } from '../../../types';
import { cn } from '../../../lib/cn.js';
import { Button } from '../../../components/ui/button.js';
import { Input } from '../../../components/ui/input.js';
import { Icon } from '../../../components/ui/Icon.js';
import { RuleBlock } from './smart-playlist-block-editor/RuleBlock.js';
import { SortBlock } from './smart-playlist-block-editor/SortBlock.js';
import { useSmartPlaylistRules } from './smart-playlist-block-editor/useSmartPlaylistRules.js';

interface SmartPlaylistBlockEditorProps {
  initialRules?: SmartPlaylistRules;
  onChange: (rules: SmartPlaylistRules) => void;
}

export function SmartPlaylistBlockEditor({ initialRules, onChange }: SmartPlaylistBlockEditorProps) {
  const rules = useSmartPlaylistRules(initialRules, onChange);
  const {
    group, sort, limit, activeKey, rulesList,
    update, updateRule, updateRuleField, removeRule, addRule, moveRule, toggleMatchType,
    addSort, removeSort, moveSort, updateSortField, updateSortDirection,
  } = rules;

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
