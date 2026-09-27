import type { ReactNode } from 'react';
import { Link } from 'wouter';
import type { SyncedLyricLine } from '../../../types';
import { Table, type TableColumn } from '../../../components/ui/Table.js';
import { ExplicitTitle } from '../../../components/ExplicitTitle.js';
import { formatDuration } from '../../../lib/format.js';

/**
 * Row-specific song shape for the table. Hand-maintained on purpose (plan
 * 10d): the table only needs a subset, and the schema-derived Song stays
 * assignable to it. `syncedLyrics` keeps the wire union — rows can carry a
 * raw LRC string, same as the full DTO.
 */
export interface SongListItem {
  id: string;
  title: string;
  artistName?: string;
  albumName?: string;
  artistId?: string | null;
  albumId?: string | null;
  artistEntries?: { id: string; name: string }[];
  duration?: number;
  explicit?: boolean;
  trackNumber?: number;
  discNumber?: number;
  syncedLyrics?: SyncedLyricLine[] | string;
  coverArt?: string;
  albumCoverArt?: string;
}

interface SongTableProps<T extends SongListItem> {
  songs: T[];
  playingId?: string;
  blurExplicit?: boolean;
  showArtist?: boolean;
  showAlbum?: boolean;
  onPlay?: (song: T) => void;
  onShufflePlay?: (song: T) => void;
  onPlaySelection?: (songs: T[], startIndex: number) => void;
  renderRow?: (song: T, row: React.ReactNode, selectedRows: T[]) => React.ReactNode;
  empty?: React.ReactNode;
  /** Override the # column label for a song. Returning undefined falls back to the 1-based row index. */
  getIndexLabel?: (song: T, index: number) => ReactNode;
  /** Group songs into sections by a shared key. Only contiguous songs with the same key are grouped together. */
  groupBy?: (song: T) => string | undefined;
  /** Render a custom header for a group. Receives the group key and the songs in the group. */
  renderGroupHeader?: (key: string, songs: T[]) => ReactNode;
}

export function SongTable<T extends SongListItem>({
  songs,
  playingId,
  blurExplicit,
  showArtist = true,
  showAlbum = true,
  onPlay,
  onShufflePlay,
  onPlaySelection,
  renderRow,
  empty,
  getIndexLabel,
  groupBy,
  renderGroupHeader,
}: SongTableProps<T>) {
  const columns: TableColumn<T>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (s) => (
        <ExplicitTitle
          title={s.title}
          explicit={s.explicit}
          blur={blurExplicit}
        />
      ),
    },
  ];

  if (showArtist) {
    columns.push({
      key: 'artist',
      header: 'Artist',
      render: (s) => {
        const entries =
          s.artistEntries && s.artistEntries.length > 0
            ? s.artistEntries
            : s.artistName
              ? [{ id: s.artistId ?? null, name: s.artistName }]
              : [];
        if (entries.length === 0) return '-';
        return (
          <span className="inline-flex flex-wrap gap-x-1">
            {entries.map((artist, index) => (
              <span key={artist.id ?? `artist-${index}`}>
                {artist.id ? (
                  <Link href={`/artists/${artist.id}`} className="hover:text-muted">
                    {artist.name}
                  </Link>
                ) : (
                  artist.name
                )}
                {index < entries.length - 1 && ','}
              </span>
            ))}
          </span>
        );
      },
    });
  }

  if (showAlbum) {
    columns.push({
      key: 'album',
      header: 'Album',
      render: (s) =>
        s.albumName ? (
          s.albumId ? (
            <Link href={`/albums/${s.albumId}`} className="hover:text-muted">
              {s.albumName}
            </Link>
          ) : (
            s.albumName
          )
        ) : (
          '-'
        ),
    });
  }

  columns.push({
    key: 'duration',
    header: 'Duration',
    className: 'w-24',
    render: (s) => (
      <span className="font-mono tabular-nums">{s.duration ? formatDuration(s.duration) : '-'}</span>
    ),
  });

  const indexPad = Math.max(2, String(songs.length).length);

  return (
    <Table
      columns={columns}
      rows={songs}
      rowKey={(s) => s.id}
      empty={empty}
      onPlay={onPlay}
      onShufflePlay={onShufflePlay}
      onPlaySelection={onPlaySelection}
      playingId={playingId}
      renderRow={renderRow}
      indexPad={indexPad}
      getIndexLabel={getIndexLabel}
      groupBy={groupBy}
      renderGroupHeader={renderGroupHeader}
    />
  );
}
