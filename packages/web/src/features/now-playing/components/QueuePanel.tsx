import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import type { User } from '@sonarly/shared';
import { LibraryView, type LibraryViewColumn } from '../../../components/LibraryView.js';
import { Icon } from '../../../components/ui/Icon.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { usePlayer, type PlayerSong } from '../../../stores/playerStore.js';
import { useNotification } from '../../../contexts/NotificationContext.js';

interface QueuePanelProps {
  user: User;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const columns: LibraryViewColumn<PlayerSong>[] = [
  {
    key: 'title',
    header: 'Title',
    render: (song) => (
      <span className="flex items-center gap-2">
        <span className="truncate">{song.title}</span>
        {song.addedByAutoDj && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
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
    render: (song) => <span className="truncate text-fg-secondary">{song.artistName || 'Unknown artist'}</span>,
  },
  {
    key: 'duration',
    header: '',
    className: 'w-16 text-right',
    render: (song) => <span className="tabular-nums text-fg-secondary">{formatTime(song.duration ?? 0)}</span>,
  },
];

export function QueuePanel({ user }: QueuePanelProps) {
  const [, setLocation] = useLocation();
  const queue = usePlayer((state) => state.queue);
  const queueIndex = usePlayer((state) => state.queueIndex);
  const currentSong = usePlayer((state) => state.currentSong);
  const playQueue = usePlayer((state) => state.playQueue);
  const { notify } = useNotification();

  // LibraryView is a controlled-ish list; keep local order in sync with store.
  const [items, setItems] = useState(queue);
  useEffect(() => setItems(queue), [queue]);

  const handlePlay = (song: PlayerSong) => {
    const index = queue.findIndex((s) => s.id === song.id);
    if (index !== -1) {
      playQueue(queue, index);
    }
  };

  const handlePlaySelection = (selected: PlayerSong[], startIndex: number) => {
    playQueue(selected, startIndex);
  };

  const handleRemove = (song: PlayerSong) => {
    const store = usePlayer.getState();
    const index = store.queue.findIndex((s) => s.id === song.id);
    if (index === -1) return;
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
        }
      } else {
        nextIndex = index + 1;
        if (nextIndex >= store.queue.length) {
          nextIndex = null;
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

  const renderContextMenu = (song: PlayerSong, children: React.ReactNode) => {
    const index = queue.findIndex((s) => s.id === song.id);
    const menuSections = [
      {
        items: [
          { id: 'play', label: 'Play now', icon: 'mdi-play', onClick: () => handlePlay(song) },
          { id: 'remove', label: 'Remove from queue', icon: 'mdi-delete', variant: 'danger' as const, onClick: () => handleRemove(song) },
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
      <ItemContextMenu key={song.id} sections={menuSections}>
        {children as React.ReactElement}
      </ItemContextMenu>
    );
  };

  if (queue.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-secondary">
        <Icon name="mdi-playlist-music" size={48} />
        <p className="text-sm">The queue is empty.</p>
      </div>
    );
  }

  return (
    <LibraryView<PlayerSong>
      title="Up next"
      data={items}
      columns={columns}
      cardFields={[]}
      getId={(song) => song.id}
      getHref={() => ''}
      onPlay={handlePlay}
      onPlaySelection={handlePlaySelection}
      renderContextMenu={renderContextMenu}
      availableViews={['list']}
      defaultView="list"
      playingId={currentSong?.id}
      emptyMessage="The queue is empty."
    />
  );
}
