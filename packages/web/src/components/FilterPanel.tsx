import { useFilterParams } from '../hooks/useFilterParams.js';
import { cn } from '../lib/cn.js';

export type FilterType = 'text' | 'select' | 'boolean';

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
}

export function FilterPanel({ filters }: FilterPanelProps) {
  const { get, set } = useFilterParams();

  return (
    <div className="rounded-md border border-rule bg-bg-primary p-4 shadow-lg">
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
                <label className="flex items-center gap-2 text-sm text-fg-primary">
                  <input
                    id={`filter-${filter.key}`}
                    type="checkbox"
                    checked={value === 'true'}
                    onChange={(e) => set(filter.key, e.target.checked ? 'true' : null)}
                    className="h-4 w-4 rounded border-rule text-accent focus:ring-accent"
                  />
                  {filter.label}
                </label>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
