import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import type { User } from '@sonarly/shared';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '../../../lib/cn.js';
import { Icon } from '../../../components/ui/Icon.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { usePlayer, type PlayerSong } from '../../../stores/playerStore.js';
import { useNotification } from '../../../contexts/NotificationContext.js';

interface QueueRowProps {
  song: PlayerSong;
  index: number;
  isCurrent: boolean;
  onPlay: (index: number) => void;
  onRemove: (index: number) => void;
  user: User;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function SortableQueueRow({ song, index, isCurrent, onPlay, onRemove, user }: QueueRowProps) {
  const [, setLocation] = useLocation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: song.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const menuSections = [
    {
      items: [
        { id: 'play', label: 'Play now', icon: 'mdi-play', onClick: () => onPlay(index) },
        { id: 'remove', label: 'Remove from queue', icon: 'mdi-delete', variant: 'danger' as const, onClick: () => onRemove(index) },
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
    <ItemContextMenu sections={menuSections}>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          'group flex items-center gap-3 rounded-lg border-l-4 px-3 py-2 transition',
          isCurrent ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-surface-hover',
          isDragging && 'z-10 scale-[1.02] shadow-lg'
        )}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className="cursor-grab text-fg-secondary opacity-0 transition hover:text-fg-primary group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
        >
          <Icon name="mdi-drag-vertical" size={18} />
        </button>
        <button
          type="button"
          onClick={() => onPlay(index)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className={cn('truncate text-sm', isCurrent ? 'font-semibold text-accent' : 'text-fg-primary')}>
            {song.title}
          </span>
          <span className="truncate text-xs text-fg-secondary">{song.artistName || 'Unknown artist'}</span>
        </button>
        <span className="text-xs tabular-nums text-fg-secondary">{formatTime(song.duration ?? 0)}</span>
        <button
          type="button"
          onClick={() => onRemove(index)}
          aria-label="Remove from queue"
          className="text-fg-secondary opacity-0 transition hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Icon name="mdi-delete" size={18} />
        </button>
      </div>
    </ItemContextMenu>
  );
}

export function QueuePanel({ user }: { user: User }) {
  const queue = usePlayer((state) => state.queue);
  const queueIndex = usePlayer((state) => state.queueIndex);
  const shuffle = usePlayer((state) => state.shuffle);
  const toggleShuffle = usePlayer((state) => state.toggleShuffle);
  const playQueue = usePlayer((state) => state.playQueue);
  const { notify } = useNotification();

  // Local optimistic order state for DnD; mirror from store whenever it changes.
  const [items, setItems] = useState(queue);
  useEffect(() => setItems(queue), [queue]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const store = usePlayer.getState();
    if (store.shuffle) {
      toggleShuffle();
      notify('Shuffle turned off to keep your queue order.', 'info');
    }
    const oldIndex = store.queue.findIndex((s) => s.id === active.id);
    const newIndex = store.queue.findIndex((s) => s.id === over.id);
    const nextQueue = arrayMove(store.queue, oldIndex, newIndex);
    let nextIndex = store.queueIndex;
    if (oldIndex === store.queueIndex) {
      nextIndex = newIndex;
    } else {
      if (oldIndex < store.queueIndex && newIndex >= store.queueIndex) nextIndex -= 1;
      if (oldIndex > store.queueIndex && newIndex <= store.queueIndex) nextIndex += 1;
    }
    usePlayer.setState({ queue: nextQueue, queueIndex: nextIndex });
    setItems(nextQueue);
  };

  const handlePlay = (index: number) => {
    playQueue(queue, index);
  };

  const handleRemove = (index: number) => {
    const store = usePlayer.getState();
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

  if (queue.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-secondary">
        <Icon name="mdi-playlist-music" size={48} />
        <p className="text-sm">The queue is empty.</p>
      </div>
    );
  }

  if (queue.length === 1) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-secondary">
        <Icon name="mdi-playlist-music" size={48} />
        <p className="text-sm">Playing the last track. Add more from the library.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs font-medium text-fg-secondary uppercase tracking-wide">Up next</span>
        <span className="text-xs text-fg-secondary">{queue.length} {queue.length === 1 ? 'track' : 'tracks'}</span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="flex-1 space-y-1 overflow-y-auto pr-1">
            {items.map((song, index) => (
              <SortableQueueRow
                key={song.id}
                song={song}
                index={index}
                isCurrent={index === queueIndex}
                onPlay={handlePlay}
                onRemove={handleRemove}
                user={user}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
