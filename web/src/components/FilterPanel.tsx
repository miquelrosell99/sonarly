import { useFilterParams } from '../hooks/useFilterParams.js';
import { cn } from '../lib/cn.js';
import { Checkbox } from './ui/checkbox.js';
import { Input } from './ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';

export type FilterType = 'text' | 'number' | 'select' | 'boolean';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterDefinition {
  key: string;
  label: string;
  type: FilterType;
  options?: FilterOption[];
}

interface FilterPanelProps {
  filters: FilterDefinition[];
  className?: string;
}

export function FilterPanel({ filters, className }: FilterPanelProps) {
  const { get, set } = useFilterParams();

  return (
    <div className={cn('rounded-item border border-outline bg-background p-4', className)}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filters.map((filter) => {
          const value = get(filter.key) ?? '';
          return (
            <div key={filter.key} className="space-y-1">
              {filter.type !== 'boolean' && (
                <label htmlFor={`filter-${filter.key}`} className="block text-xs font-medium text-on-surface-variant">
                  {filter.label}
                </label>
              )}
              {filter.type === 'text' && (
                <Input
                  id={`filter-${filter.key}`}
                  type="text"
                  value={value}
                  onChange={(e) => set(filter.key, e.target.value)}
                />
              )}
              {filter.type === 'number' && (
                <Input
                  id={`filter-${filter.key}`}
                  type="number"
                  value={value}
                  onChange={(e) => set(filter.key, e.target.value)}
                />
              )}
              {filter.type === 'select' && (
                /* Radix Select items can't carry an empty value, so "All"
                   rides the '__all' sentinel and maps back to null. */
                <Select
                  value={value || '__all'}
                  onValueChange={(next) => set(filter.key, next === '__all' ? null : next)}
                >
                  <SelectTrigger id={`filter-${filter.key}`} aria-label={filter.label}>
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All</SelectItem>
                    {filter.options?.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {filter.type === 'boolean' && (
                <Checkbox
                  id={`filter-${filter.key}`}
                  label={filter.label}
                  checked={value === 'true'}
                  onChange={(e) => set(filter.key, e.target.checked ? 'true' : null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
