import { useFilterParams } from '../hooks/useFilterParams.js';
import { cn } from '../lib/cn.js';
import { Checkbox } from './ui/Checkbox.js';

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
    <div className={cn('rounded-md border border-rule bg-bg-primary p-4 shadow-lg', className)}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filters.map((filter) => {
          const value = get(filter.key) ?? '';
          return (
            <div key={filter.key} className="space-y-1">
              <label htmlFor={`filter-${filter.key}`} className="block text-xs font-medium text-muted">
                {filter.label}
              </label>
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
                <select
                  id={`filter-${filter.key}`}
                  value={value}
                  onChange={(e) => set(filter.key, e.target.value || null)}
                  className={cn('input appearance-none', !value && 'text-muted')}
                >
                  <option value="">All</option>
                  {filter.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
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
