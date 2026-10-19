import { useFilterParams } from '../hooks/useFilterParams.js';
import { cn } from '../lib/cn.js';
import { Checkbox } from './ui/Checkbox.js';
import { Icon } from './ui/Icon.js';

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
                <input
                  id={`filter-${filter.key}`}
                  type="text"
                  value={value}
                  onChange={(e) => set(filter.key, e.target.value)}
                  className="input"
                />
              )}
              {filter.type === 'number' && (
                <input
                  id={`filter-${filter.key}`}
                  type="number"
                  value={value}
                  onChange={(e) => set(filter.key, e.target.value)}
                  className="input"
                />
              )}
              {filter.type === 'select' && (
                <div className="relative">
                  <select
                    id={`filter-${filter.key}`}
                    value={value}
                    onChange={(e) => set(filter.key, e.target.value || null)}
                    className={cn('input appearance-none', !value && 'text-on-surface-variant')}
                  >
                    <option value="">All</option>
                    {filter.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <Icon
                    name="mdi-chevron-down"
                    size={16}
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
                  />
                </div>
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
