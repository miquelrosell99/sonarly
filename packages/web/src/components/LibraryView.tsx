import { useState, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import { Card } from './Card.js';
import { ListRow } from './ListRow.js';
import { ItemContextMenu, type ContextMenuItem } from './ItemContextMenu.js';

export interface LibraryViewColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
}

export interface LibraryViewCardField<T> {
  key: string;
  label?: ReactNode;
  render: (item: T) => ReactNode;
}

interface LibraryViewProps<T> {
  title: string;
  data: T[];
  isLoading?: boolean;
  error?: string | Error | null;
  columns: LibraryViewColumn<T>[];
  cardFields: LibraryViewCardField<T>[];
  getId: (item: T) => string;
  getHref: (item: T) => string;
  onPlay?: (item: T) => void;
  onShufflePlay?: (data: T[]) => void;
  onFavorite?: (item: T, starred: boolean) => void;
  onRate?: (item: T, rating?: number) => void;
  getFavorite?: (item: T) => boolean | undefined;
  getRating?: (item: T) => number | undefined;
  renderContextMenu?: (item: T) => ContextMenuItem[];
  emptyMessage?: string;
}

type ViewMode = 'list' | 'grid';

export function LibraryView<T>({
  title,
  data,
  isLoading,
  error,
  columns,
  cardFields,
  getId,
  getHref,
  onPlay,
  onShufflePlay,
  onFavorite,
  onRate,
  getFavorite,
  getRating,
  renderContextMenu,
  emptyMessage = 'No items found.',
}: LibraryViewProps<T>) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const errorText = error instanceof Error ? error.message : error ?? null;

  if (isLoading) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted">Loading...</p>
      </div>
    );
  }

  if (errorText) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        <p className="text-sm text-danger">{errorText}</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        <p className="py-8 text-center text-sm text-muted">{emptyMessage}</p>
      </div>
    );
  }

  const renderList = () => (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-rule text-muted">
          <tr>
            <th className="w-12 py-2 pr-4 font-medium">#</th>
            {columns.map((col) => (
              <th key={col.key} className={cn('py-2 pr-4 font-medium', col.className)}>
                {col.header}
              </th>
            ))}
            {onFavorite && <th className="w-10 py-2 pr-4 font-medium" aria-label="Favorite" />}
            {onRate && <th className="w-32 py-2 pr-4 font-medium" aria-label="Rating" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {data.map((item, index) => {
            const href = getHref(item);
            const contextItems = renderContextMenu ? renderContextMenu(item) : [];
            const starred = getFavorite?.(item);
            const rating = getRating?.(item);
            const row = (
              <ListRow
                href={href}
                index={index}
                onPlay={onPlay ? () => onPlay(item) : undefined}
                favorite={onFavorite ? { starred, onClick: () => onFavorite(item, !starred) } : undefined}
                rating={onRate ? { value: rating, onRate: (value) => onRate(item, value || undefined) } : undefined}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn('py-2 pr-4', col.className)}>
                    {col.render(item)}
                  </td>
                ))}
              </ListRow>
            );
            return <ItemContextMenu key={getId(item)} items={contextItems}>{row}</ItemContextMenu>;
          })}
        </tbody>
      </table>
    </div>
  );

  const renderGrid = () => (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {data.map((item) => {
        const href = getHref(item);
        const contextItems = renderContextMenu ? renderContextMenu(item) : [];
        const starred = getFavorite?.(item);
        const rating = getRating?.(item);
        const card = (
          <Card
            href={href}
            favorite={onFavorite ? { starred, onClick: () => onFavorite(item, !starred) } : undefined}
            rating={onRate ? { value: rating, onRate: (value) => onRate(item, value || undefined) } : undefined}
            play={onPlay ? { onClick: () => onPlay(item) } : undefined}
          >
            <div className="space-y-1">
              {cardFields.map((field, idx) => (
                <div
                  key={field.key}
                  className={cn(
                    'text-sm text-fg-primary',
                    idx === 0 ? 'font-medium' : 'text-muted',
                  )}
                >
                  {field.render(item)}
                </div>
              ))}
            </div>
          </Card>
        );
        return <ItemContextMenu key={getId(item)} items={contextItems}>{card}</ItemContextMenu>;
      })}
    </div>
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="flex items-center gap-2">
          {onShufflePlay && (
            <button
              type="button"
              aria-label="Shuffle play"
              onClick={() => onShufflePlay(data)}
              disabled={data.length === 0}
              className="inline-flex items-center rounded-md border border-rule bg-surface p-2 text-fg-primary transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              <Icon name="mdi-shuffle" size={20} />
            </button>
          )}
          <div className="flex items-center rounded-md border border-rule bg-surface p-1">
            <button
              type="button"
              aria-label="List view"
              onClick={() => setViewMode('list')}
              className={cn(
                'rounded p-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                viewMode === 'list' ? 'bg-surface-hover text-accent' : 'text-muted hover:text-fg-primary',
              )}
            >
              <Icon name="mdi-format-list-bulleted" size={20} />
            </button>
            <button
              type="button"
              aria-label="Grid view"
              onClick={() => setViewMode('grid')}
              className={cn(
                'rounded p-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                viewMode === 'grid' ? 'bg-surface-hover text-accent' : 'text-muted hover:text-fg-primary',
              )}
            >
              <Icon name="mdi-view-grid-outline" size={20} />
            </button>
          </div>
        </div>
      </div>
      {viewMode === 'list' ? renderList() : renderGrid()}
    </div>
  );
}
