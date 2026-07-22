import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
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
  renderContextMenu?: (item: T) => ContextMenuItem[];
  emptyMessage?: string;
}

type ViewMode = 'list' | 'grid';

function isInteractiveTarget(target: EventTarget) {
  const el = target as HTMLElement;
  return el.closest('a, button, [role="menuitem"]') !== null;
}

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
  renderContextMenu,
  emptyMessage = 'No items found.',
}: LibraryViewProps<T>) {
  const [, setLocation] = useLocation();
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
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {data.map((item, index) => {
            const href = getHref(item);
            const contextItems = renderContextMenu ? renderContextMenu(item) : [];
            const row = (
              <tr
                key={getId(item)}
                className="group cursor-pointer transition hover:bg-surface-hover"
                onClick={(e) => {
                  if (!isInteractiveTarget(e.target)) {
                    setLocation(href);
                  }
                }}
              >
                <td className="py-2 pr-4">
                  <span className="inline-flex items-center text-muted">
                    <span className="group-hover:hidden">{index + 1}</span>
                    {onPlay && (
                      <button
                        type="button"
                        className="hidden text-accent hover:text-accent/80 focus-visible:outline-none group-hover:inline-flex"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPlay(item);
                        }}
                        aria-label="Play"
                      >
                        <Icon name="mdi-play" size={18} />
                      </button>
                    )}
                  </span>
                </td>
                {columns.map((col) => (
                  <td key={col.key} className={cn('py-2 pr-4', col.className)}>
                    {col.render(item)}
                  </td>
                ))}
              </tr>
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
        const card = (
          <div className="group relative">
            <Link
              href={href}
              className="block overflow-hidden rounded-md border border-rule bg-surface p-3 transition hover:border-accent hover:bg-surface-hover"
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
            </Link>
            {onPlay && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onPlay(item);
                }}
                className="pointer-events-auto absolute right-2 top-2 z-10 hidden rounded-full bg-accent p-2 text-bg-primary shadow transition hover:bg-accent/90 focus-visible:outline-none group-hover:block"
                aria-label="Play"
              >
                <Icon name="mdi-play" size={20} />
              </button>
            )}
          </div>
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
