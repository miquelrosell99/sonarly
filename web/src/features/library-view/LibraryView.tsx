import { Icon } from '../../components/ui/Icon.js';
import { PageState } from '../../components/PageState.js';
import { useScrollParent } from '../../components/ui/useScrollParent.js';
import { usePersistentViewMode } from '../../hooks/usePersistentViewMode.js';
import {
  useColumnConfig,
  resolveColumns,
  DEFAULT_LOCKED_COLUMN_KEYS,
  type ColumnConfigColumn,
} from '../../hooks/useColumnConfig.js';
import { ColumnConfigMenu } from '../../components/ColumnConfigMenu.js';
import { cn } from '../../lib/cn.js';
import { LibraryList } from './LibraryList.js';
import { LibraryGrid } from './LibraryGrid.js';
import { useLibrarySelection } from './useLibrarySelection.js';
import type { LibraryViewProps } from './types.js';

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
  onPlaySelection,
  onShufflePlay,
  disableRowShuffle,
  onFavorite,
  onRate,
  getFavorite,
  getRating,
  renderContextMenu,
  emptyMessage = 'No items found.',
  emptyDescription,
  emptyAction,
  onRetry,
  defaultView = 'list',
  availableViews = ['list', 'grid'],
  viewModeKey,
  columnConfigKey,
  getCover,
  getCoverAlt,
  renderCover,
  playingId,
  sortable = false,
  onReorder,
  getRowClassName,
  getIndexLabel,
  groupBy,
  renderGroupHeader,
  getDragSongIds,
  virtualizeThreshold = 150,
}: LibraryViewProps<T>) {
  const effectiveDefaultView = availableViews.includes(defaultView) ? defaultView : availableViews[0];
  const [viewMode, setViewMode] = usePersistentViewMode(viewModeKey, effectiveDefaultView, availableViews);
  // Column configuration (audit: column configurator) — order + visibility
  // persist per view key; locked columns (title, row actions) reorder but
  // never hide. Without a key the view renders its natural column set.
  const availableColumns: ColumnConfigColumn[] = columns.map((column) => ({
    key: column.key,
    label: typeof column.header === 'string' ? column.header : column.key,
  }));
  const columnConfig = useColumnConfig(columnConfigKey, availableColumns, DEFAULT_LOCKED_COLUMN_KEYS);
  const visibleColumns = resolveColumns(columns, columnConfig.visibleKeys);
  const selection = useLibrarySelection(data, getId, onPlaySelection);
  const { ref: scrollAnchorRef, scrollParent } = useScrollParent<HTMLDivElement>();

  const errorText = error instanceof Error ? error.message : error ?? null;

  if (isLoading) {
    return (
      <div>
        {title && <h1 className="mb-4 font-display text-lg font-semibold tracking-tight">{title}</h1>}
        <PageState loading>{null}</PageState>
      </div>
    );
  }

  if (errorText) {
    return (
      <div>
        {title && <h1 className="mb-4 font-display text-lg font-semibold tracking-tight">{title}</h1>}
        <PageState error={errorText} onRetry={onRetry}>{null}</PageState>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div>
        {title && <h1 className="mb-4 font-display text-lg font-semibold tracking-tight">{title}</h1>}
        <PageState isEmpty emptyMessage={emptyMessage} emptyDescription={emptyDescription} emptyAction={emptyAction}>{null}</PageState>
      </div>
    );
  }

  const showColumnConfig = columnConfigKey !== undefined && viewMode === 'list';

  const shared = {
    data,
    getId,
    getHref,
    onPlay,
    onShufflePlay,
    disableRowShuffle,
    onFavorite,
    onRate,
    getFavorite,
    getRating,
    renderContextMenu,
    playingId,
    scrollParent,
    virtualizeThreshold,
  };

  return (
    <div ref={scrollAnchorRef}>
      {(title || showColumnConfig) && (
        <div className="mb-4 flex items-center justify-between">
          {title && <h1 className="font-display text-lg font-semibold tracking-tight">{title}</h1>}
          <div className="flex items-center gap-2">
            {onShufflePlay && (
              <button
                type="button"
                aria-label="Shuffle play"
                onClick={() => onShufflePlay(data)}
                disabled={data.length === 0}
                className="inline-flex items-center rounded-item border border-outline bg-surface p-2 text-on-surface transition hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
              >
                <Icon name="mdi-shuffle" size={20} />
              </button>
            )}
            {availableViews.length > 1 && (
              <div className="flex items-center rounded-item border border-outline bg-surface p-1">
                {availableViews.includes('list') && (
                  <button
                    type="button"
                    aria-label="List view"
                    onClick={() => setViewMode('list')}
                    className={cn(
                      'rounded-item p-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      viewMode === 'list' ? 'bg-surface-container-high text-primary' : 'text-on-surface-variant hover:text-on-surface',
                    )}
                  >
                    <Icon name="mdi-format-list-bulleted" size={20} />
                  </button>
                )}
                {availableViews.includes('grid') && (
                  <button
                    type="button"
                    aria-label="Grid view"
                    onClick={() => setViewMode('grid')}
                    className={cn(
                      'rounded-item p-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      viewMode === 'grid' ? 'bg-surface-container-high text-primary' : 'text-on-surface-variant hover:text-on-surface',
                    )}
                  >
                    <Icon name="mdi-view-grid-outline" size={20} />
                  </button>
                )}
              </div>
            )}
            {showColumnConfig && (
              <ColumnConfigMenu
                entries={columnConfig.entries}
                actionsLabel="Row actions"
                onToggle={columnConfig.toggle}
                onMove={columnConfig.move}
              />
            )}
          </div>
        </div>
      )}
      {viewMode === 'list' ? (
        <LibraryList
          {...shared}
          columns={visibleColumns}
          sortable={sortable}
          onReorder={onReorder}
          getRowClassName={getRowClassName}
          getIndexLabel={getIndexLabel}
          groupBy={groupBy}
          renderGroupHeader={renderGroupHeader}
          getDragSongIds={getDragSongIds}
          selection={selection}
        />
      ) : (
        <LibraryGrid
          {...shared}
          cardFields={cardFields}
          getCover={getCover}
          getCoverAlt={getCoverAlt}
          renderCover={renderCover}
        />
      )}
    </div>
  );
}
