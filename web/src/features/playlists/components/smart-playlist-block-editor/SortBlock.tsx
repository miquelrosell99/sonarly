import type { SmartPlaylistSort } from '../../../../types';
import { SMART_PLAYLIST_FIELDS } from '../../../../types';
import { cn } from '../../../../lib/cn.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select.js';
import { Icon } from '../../../../components/ui/Icon.js';

export function SortBlock({
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
