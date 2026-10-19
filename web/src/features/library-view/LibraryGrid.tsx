import { Fragment, type ReactNode } from 'react';
import { Card } from '../../components/Card.js';
import { CoverArt } from '../../components/CoverArt.js';
import { VirtualGrid } from '../../components/ui/VirtualGrid.js';
import type { LibraryViewCardField } from './types.js';

export interface LibraryGridProps<T> {
  data: T[];
  getId: (item: T) => string;
  getHref: (item: T) => string;
  cardFields: LibraryViewCardField<T>[];
  onPlay?: (item: T) => void;
  onShufflePlay?: (data: T[]) => void;
  disableRowShuffle?: boolean;
  onFavorite?: (item: T, starred: boolean) => void;
  onRate?: (item: T, rating?: number) => void;
  getFavorite?: (item: T) => boolean | undefined;
  getRating?: (item: T) => number | undefined;
  renderContextMenu?: (item: T, children: ReactNode, selectedItems: T[]) => ReactNode;
  getCover?: (item: T) => string | undefined;
  getCoverAlt?: (item: T) => string;
  renderCover?: (item: T) => ReactNode;
  playingId?: string;
  scrollParent: HTMLElement | null;
  virtualizeThreshold: number;
}

export function LibraryGrid<T>({
  data,
  getId,
  getHref,
  cardFields,
  onPlay,
  onShufflePlay,
  disableRowShuffle,
  onFavorite,
  onRate,
  getFavorite,
  getRating,
  renderContextMenu,
  getCover,
  getCoverAlt,
  renderCover,
  playingId,
  scrollParent,
  virtualizeThreshold,
}: LibraryGridProps<T>) {
  const renderCardItem = (item: T) => {
    const href = getHref(item);
    const starred = getFavorite?.(item);
    const rating = getRating?.(item);
    const coverId = getCover?.(item);
    const customCover = renderCover?.(item);
    const isPlaying = playingId !== undefined && playingId === getId(item);
    const [titleField, ...extraFields] = cardFields;
    const coverElement =
      customCover ??
      (coverId !== undefined ? (
        <CoverArt coverArt={coverId} alt={getCoverAlt?.(item) ?? 'Cover art'} />
      ) : undefined);
    const card = (
      <Card
        href={href}
        title={titleField.render(item)}
        fields={extraFields.map((field) => ({
          content: field.render(item),
          href: field.getHref?.(item),
        }))}
        cover={coverElement}
        favorite={onFavorite ? { starred, onClick: () => onFavorite(item, !starred) } : undefined}
        rating={onRate ? { value: rating, onRate: (value) => onRate(item, value || undefined) } : undefined}
        play={onPlay ? { onPlay: () => onPlay(item), onShufflePlay: onShufflePlay && !disableRowShuffle ? () => onShufflePlay(data) : undefined } : undefined}
        isPlaying={isPlaying}
      />
    );
    return renderContextMenu ? renderContextMenu(item, card, [item]) : card;
  };

  // Virtualize large grids from the first commit — VirtualGrid renders a
  // cheap fixed window until the scroll parent resolves (see its
  // FALLBACK_CARDS note); gating on scrollParent rendered every card on
  // section opens.
  const useVirtualGrid = data.length > virtualizeThreshold;

  if (useVirtualGrid) {
    // className carries the grid marker + column config for styling hooks;
    // VirtualGrid owns layout (absolute positioning inside a sized box).
    return (
      <VirtualGrid
        items={data}
        getId={getId}
        scrollElement={scrollParent}
        className="library-view-grid"
        renderItem={renderCardItem}
      />
    );
  }

  return (
    <div className="library-view-grid grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {data.map((item) => (
        <Fragment key={getId(item)}>{renderCardItem(item)}</Fragment>
      ))}
    </div>
  );
}
