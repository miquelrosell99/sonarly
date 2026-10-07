import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import type { AutoDjMode, User } from '../../../types';
import { LibraryView, type LibraryViewColumn } from '../../../components/LibraryView.js';
import { Icon } from '../../../components/ui/Icon.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { cn } from '../../../lib/cn.js';
import { usePlayer, type PlayerSong } from '../../../stores/playerStore.js';
import { useAutoDjUi } from '../../../stores/autoDjStore.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { usePreferences, useUpdatePreferences } from '../../../hooks/usePreferences.js';
import { SaveQueueAsPlaylistModal } from './SaveQueueAsPlaylistModal.js';
import { AutoDjTunePopover } from './AutoDjTunePopover.js';

interface QueueListProps {
  user: User;
  title?: string;
  showHeader?: boolean;
  className?: string;
}

type QueueItemStatus = 'past' | 'current' | 'future';

interface QueueDisplayItem {
  id: string;
  song: PlayerSong;
  originalIndex: number;
  status: QueueItemStatus;
}

const AUTO_DJ_GROUP_KEY = 'auto-dj';

// Drag-reorder and the Auto-DJ section header need every row mounted, which
// makes a whole-library-shuffle queue (thousands of rows) take seconds to
// open. Past this size the queue switches to the windowed renderer:
// dragging across thousands of rows is impractical anyway, and Auto-DJ picks
// keep their per-row badge instead of the section header.
const QUEUE_FULL_RENDER_LIMIT = 500;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function buildDisplayItems(
  queue: PlayerSong[],
  queueIndex: number,
  shuffle: boolean,
  shuffledIndices: number[],
): QueueDisplayItem[] {
  const withStatus = (originalIndex: number, position: number): QueueDisplayItem => {
    const song = queue[originalIndex];
    let status: QueueItemStatus;
    if (originalIndex === queueIndex) {
      status = 'current';
    } else if (shuffle) {
      const currentPosition = shuffledIndices.indexOf(queueIndex);
      status = position < currentPosition ? 'past' : 'future';
    } else {
      status = originalIndex < queueIndex ? 'past' : 'future';
    }
    return { id: `${song.id}-${originalIndex}`, song, originalIndex, status };
  };

  if (shuffle && shuffledIndices.length > 0) {
    return shuffledIndices.map((originalIndex, position) => withStatus(originalIndex, position));
  }

  return queue.map((_, originalIndex) => withStatus(originalIndex, originalIndex));
}

// Pulsing live indicator for the active Auto-DJ; the ping is suppressed under
// reduced motion (the solid dot stays).
function AutoDjLiveDot() {
  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:hidden" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
    </span>
  );
}

export function QueueList({ title, showHeader = true, className }: QueueListProps) {
  const [, setLocation] = useLocation();
  const queue = usePlayer((state) => state.queue);
  const queueIndex = usePlayer((state) => state.queueIndex);
  const currentSong = usePlayer((state) => state.currentSong);
  const shuffle = usePlayer((state) => state.shuffle);
  const shuffledIndices = usePlayer((state) => state.shuffledIndices);
  const playAtIndex = usePlayer((state) => state.playAtIndex);
  const clearQueue = usePlayer((state) => state.clearQueue);
  const { data: preferences } = usePreferences();
  const updatePreferences = useUpdatePreferences();
  const autoDjEnabled = preferences?.autoDjEnabled ?? false;
  const autoDjMode = preferences?.autoDjMode ?? 'smart';
  const isFetching = useAutoDjUi((state) => state.isFetching);
  const requestRefresh = useAutoDjUi((state) => state.requestRefresh);
  const djModeItems: { id: AutoDjMode; label: string; icon: string }[] = [
    { id: 'similar', label: 'Similar', icon: 'mdi-account-music' },
    { id: 'random', label: 'Random', icon: 'mdi-shuffle' },
    { id: 'smart', label: 'Smart', icon: 'mdi-brain' },
  ];
  const { notify } = useNotification();

  const displayItems = useMemo(
    () => buildDisplayItems(queue, queueIndex, shuffle, shuffledIndices),
    [queue, queueIndex, shuffle, shuffledIndices],
  );

  // While Auto DJ is active, upcoming DJ picks render as their own section.
  // Items stay in the single player queue (drag/reorder semantics unchanged);
  // grouping only labels the contiguous run — usually the queue tail. Large
  // queues skip the section (windowed rows can't group) — the per-row badge
  // labels DJ picks instead.
  const windowed = displayItems.length > QUEUE_FULL_RENDER_LIMIT;
  const djSectionIds = useMemo(() => {
    if (!autoDjEnabled || windowed) return new Set<string>();
    return new Set(
      displayItems
        .filter((item) => item.status === 'future' && item.song.addedByAutoDj)
        .map((item) => item.id),
    );
  }, [autoDjEnabled, windowed, displayItems]);
  // Windowed queues lose the grouped Auto-DJ section (grouping cannot
  // survive windowing) — a bar above the list carries the same label and
  // refresh/tune controls instead.
  const djPickCount = useMemo(
    () =>
      autoDjEnabled
        ? displayItems.filter((item) => item.status === 'future' && item.song.addedByAutoDj).length
        : 0,
    [autoDjEnabled, displayItems],
  );
  const futureCount = useMemo(
    () => displayItems.filter((item) => item.status === 'future').length,
    [displayItems],
  );

  const [items, setItems] = useState(displayItems);
  useEffect(() => setItems(displayItems), [displayItems]);

  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [tuneOpen, setTuneOpen] = useState(false);
  const tuneAnchorRef = useRef<HTMLButtonElement>(null);

  const columns: LibraryViewColumn<QueueDisplayItem>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (item) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0">
            <span
              className={cn('block truncate', item.status === 'current' && 'font-medium text-accent')}
              title={item.song.title}
            >
              {item.song.title}
            </span>
            {item.song.addedByAutoDj && item.song.autoDjReason && (
              <span className="block truncate text-xs text-muted" title={item.song.autoDjReason}>
                {item.song.autoDjReason}
              </span>
            )}
          </span>
          {item.song.addedByAutoDj && !djSectionIds.has(item.id) && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent/70">
              <Icon name="mdi-robot" size={12} />
              Auto DJ
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'artist',
      header: 'Artist',
      render: (item) => <span className="truncate text-fg-secondary">{item.song.artistName || 'Unknown artist'}</span>,
    },
    {
      key: 'duration',
      header: '',
      className: 'w-16 text-right',
      render: (item) => <span className="font-mono tabular-nums text-fg-secondary">{formatTime(item.song.duration ?? 0)}</span>,
    },
  ];

  const getRowClassName = (item: QueueDisplayItem) => {
    switch (item.status) {
      case 'past':
        return 'opacity-50';
      case 'current':
        return 'bg-accent/10';
      default:
        return '';
    }
  };

  const handlePlay = (item: QueueDisplayItem) => {
    playAtIndex(item.originalIndex);
  };

  const handlePlaySelection = (selected: QueueDisplayItem[], startIndex: number) => {
    const originalStartIndex = selected[startIndex]?.originalIndex ?? 0;
    playAtIndex(originalStartIndex);
  };

  const handleReorder = (nextItems: QueueDisplayItem[]) => {
    const store = usePlayer.getState();
    const activeItem = nextItems.find((item, i) => items[i]?.id !== item.id);
    if (!activeItem) return;

    const oldPosition = items.findIndex((item) => item.id === activeItem.id);
    const newPosition = nextItems.findIndex((item) => item.id === activeItem.id);
    if (oldPosition === -1 || newPosition === -1 || oldPosition === newPosition) return;

    if (store.shuffle) {
      const nextShuffled = nextItems.map((item) => item.originalIndex);
      usePlayer.setState({ shuffledIndices: nextShuffled });
      setItems(nextItems);
      return;
    }

    const nextQueue = nextItems.map((item) => item.song);
    const nextQueueIndex = nextItems.findIndex((item) => item.originalIndex === store.queueIndex);

    usePlayer.setState({ queue: nextQueue, queueIndex: nextQueueIndex });
    setItems(nextItems);
  };

  const handleRemove = (item: QueueDisplayItem) => {
    const store = usePlayer.getState();
    const index = item.originalIndex;
    if (index < 0 || index >= store.queue.length) return;
    const isCurrent = index === store.queueIndex;
    const nextQueue = store.queue.filter((_, i) => i !== index);

    const adjustShuffledIndices = () =>
      store.shuffledIndices
        .filter((i) => i !== index)
        .map((i) => (i > index ? i - 1 : i));

    if (isCurrent) {
      let nextIndex: number | null = null;
      if (store.shuffle) {
        const position = store.shuffledIndices.indexOf(index);
        const nextPosition = position + 1;
        if (nextPosition < store.shuffledIndices.length) {
          nextIndex = store.shuffledIndices[nextPosition];
        } else if (position > 0) {
          // No next item in the shuffled order; fall back to the previous one.
          nextIndex = store.shuffledIndices[position - 1];
        }
      } else {
        nextIndex = index + 1;
        if (nextIndex >= store.queue.length) {
          // Removing the last item: fall back to the previous one instead of
          // nulling the current song while tracks remain.
          nextIndex = index > 0 ? index - 1 : null;
        }
      }

      if (nextIndex === null || nextQueue.length === 0) {
        usePlayer.setState({
          queue: nextQueue,
          queueIndex: 0,
          currentSong: null,
          status: 'idle',
          currentTime: 0,
          duration: 0,
          shuffledIndices: store.shuffle ? adjustShuffledIndices() : [],
        });
      } else {
        if (nextIndex > index) nextIndex -= 1;
        const nextSong = nextQueue[nextIndex];
        usePlayer.setState({
          queue: nextQueue,
          queueIndex: nextIndex,
          currentSong: nextSong,
          status: 'playing',
          currentTime: 0,
          duration: nextSong?.duration ?? 0,
          ...(store.shuffle ? { shuffledIndices: adjustShuffledIndices() } : {}),
        });
      }
      return;
    }

    let nextIndex = store.queueIndex;
    if (index < store.queueIndex) {
      nextIndex = Math.max(0, nextIndex - 1);
    }
    nextIndex = Math.min(nextIndex, Math.max(0, nextQueue.length - 1));
    usePlayer.setState({
      queue: nextQueue,
      queueIndex: nextIndex,
      ...(store.shuffle ? { shuffledIndices: adjustShuffledIndices() } : {}),
    });
  };

  const renderContextMenu = (item: QueueDisplayItem, children: React.ReactNode, _selectedItems: QueueDisplayItem[]) => {
    const song = item.song;
    const menuSections = [
      {
        items: [
          { id: 'play', label: 'Play now', icon: 'mdi-play', onClick: () => handlePlay(item) },
          { id: 'remove', label: 'Remove from queue', icon: 'mdi-delete', variant: 'danger' as const, onClick: () => handleRemove(item) },
        ],
      },
      {
        items: [
          ...(song.albumId ? [{ id: 'album', label: 'Go to album', icon: 'mdi-album', onClick: () => setLocation(`/albums/${song.albumId}`) }] : []),
          ...(song.artistId ? [{ id: 'artist', label: 'Go to artist', icon: 'mdi-account-music', onClick: () => setLocation(`/artists/${song.artistId}`) }] : []),
        ],
      },
    ];
    return (
      <ItemContextMenu key={item.id} sections={menuSections}>
        {children as React.ReactElement}
      </ItemContextMenu>
    );
  };

  const renderDjControls = (count: number) => (
    <span className="flex items-center justify-between gap-2 py-1">
      <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
        <AutoDjLiveDot />
        Up next — Auto-DJ
        <span className="text-muted">· {count}</span>
      </span>
      <span className="flex items-center gap-1">
        <button
          type="button"
          onClick={requestRefresh}
          disabled={isFetching}
          aria-label="Refresh Auto-DJ suggestions"
          title="Fresh suggestions"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        >
          <Icon name="mdi-refresh" size={14} className={cn(isFetching && 'animate-spin')} />
        </button>
        <button
          type="button"
          ref={tuneAnchorRef}
          onClick={() => setTuneOpen((v) => !v)}
          aria-label="Auto DJ settings"
          title="Tune Auto DJ"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Icon name="mdi-cog" size={14} />
        </button>
      </span>
    </span>
  );

  const renderDjGroupHeader = (_key: string, groupItems: QueueDisplayItem[]) =>
    renderDjControls(groupItems.length);

  if (queue.length === 0) {
    return (
      <div className={`flex h-full flex-col items-center justify-center gap-2 text-fg-secondary ${className ?? ''}`}>
        <Icon name="mdi-playlist-music" size={48} />
        <p className="text-sm">The queue is empty.</p>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex shrink-0 justify-end gap-1 pb-1">
        <ItemContextMenu
          sections={[
            {
              items: djModeItems.map((mode) => ({
                id: mode.id,
                label: mode.label,
                icon: mode.icon,
                active: autoDjMode === mode.id,
                onClick: () => updatePreferences.mutate({ autoDjMode: mode.id }),
              })),
            },
          ]}
          anchorToTrigger
          placement="top-end"
        >
          <button
            type="button"
            onClick={() => updatePreferences.mutate({ autoDjEnabled: !autoDjEnabled })}
            aria-label={`Auto DJ: ${autoDjEnabled ? 'on' : 'off'}`}
            aria-pressed={autoDjEnabled}
            title="Auto DJ (right-click for mode)"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              autoDjEnabled
                ? 'bg-accent/15 text-accent hover:bg-accent/25'
                : 'text-fg-secondary hover:bg-surface-hover hover:text-fg-primary',
            )}
          >
            <Icon name="mdi-record-player" size={14} />
            Auto DJ
          </button>
        </ItemContextMenu>
        <button
          type="button"
          onClick={() => setSaveModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Icon name="mdi-playlist-plus" size={14} />
          Save as playlist
        </button>
        {queue.length > 1 && (
          <button
            type="button"
            onClick={() => {
              clearQueue();
              notify('Queue cleared', 'info');
            }}
            className="rounded-full px-3 py-2 text-xs font-medium text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Clear queue
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {windowed && autoDjEnabled && djPickCount > 0 && (
          <div className="shrink-0 border-b border-rule/50 px-1">{renderDjControls(djPickCount)}</div>
        )}
        <LibraryView<QueueDisplayItem>
          title={showHeader ? (title ?? 'Up next') : undefined}
          data={items}
          columns={columns}
          cardFields={[]}
          getId={(item) => item.id}
          getHref={() => ''}
          onPlay={handlePlay}
          onPlaySelection={handlePlaySelection}
          renderContextMenu={renderContextMenu}
          availableViews={['list']}
          defaultView="list"
          playingId={currentSong ? `${currentSong.id}-${queueIndex}` : undefined}
          emptyMessage="The queue is empty."
          sortable={!windowed}
          onReorder={windowed ? undefined : handleReorder}
          getRowClassName={getRowClassName}
          groupBy={autoDjEnabled && !windowed ? (item) => (djSectionIds.has(item.id) ? AUTO_DJ_GROUP_KEY : '') : undefined}
          renderGroupHeader={autoDjEnabled && !windowed ? renderDjGroupHeader : undefined}
        />
      </div>
      {futureCount === 0 && autoDjEnabled && (
        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-rule/50 bg-surface px-3 py-2 text-xs text-fg-secondary">
          <AutoDjLiveDot />
          <span className="flex-1">Queue's end — Auto-DJ will keep it going</span>
          {isFetching && <span className="text-muted">Fetching…</span>}
        </div>
      )}
      {futureCount === 0 && !autoDjEnabled && (
        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-rule/50 bg-surface px-3 py-2 text-xs text-fg-secondary">
          <Icon name="mdi-record-player" size={14} className="text-muted" />
          <span className="flex-1">Queue's end — turn on Auto DJ to keep listening</span>
          <button
            type="button"
            onClick={() => updatePreferences.mutate({ autoDjEnabled: true })}
            className="rounded-full bg-accent/15 px-2.5 py-1 font-medium text-accent transition hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Turn on Auto DJ
          </button>
        </div>
      )}
      {saveModalOpen && (
        <SaveQueueAsPlaylistModal
          open={saveModalOpen}
          onClose={() => setSaveModalOpen(false)}
          songIds={queue.map((song) => song.id)}
        />
      )}
      <AutoDjTunePopover anchorRef={tuneAnchorRef} open={tuneOpen} onClose={() => setTuneOpen(false)} />
    </div>
  );
}
