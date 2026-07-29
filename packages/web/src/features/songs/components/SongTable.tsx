import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { Table, type TableColumn } from '../../../components/ui/Table.js';
import { ExplicitTitle } from '../../../components/ExplicitTitle.js';
import { formatDuration } from '../../../lib/format.js';

export interface SongListItem {
  id: string;
  title: string;
  artistName?: string;
  albumName?: string;
  artistId?: string | null;
  albumId?: string | null;
  duration?: number;
  explicit?: boolean;
  trackNumber?: number;
  discNumber?: number;
  syncedLyrics?: { time: number; text: string }[];
}

interface SongTableProps {
  songs: SongListItem[];
  playingId?: string;
  blurExplicit?: boolean;
  showArtist?: boolean;
  showAlbum?: boolean;
  onPlay?: (song: SongListItem) => void;
  onShufflePlay?: (song: SongListItem) => void;
  onPlaySelection?: (songs: SongListItem[], startIndex: number) => void;
  renderRow?: (song: SongListItem, row: React.ReactNode, selectedRows: SongListItem[]) => React.ReactNode;
  empty?: React.ReactNode;
  /** Override the # column label for a song. Returning undefined falls back to the 1-based row index. */
  getIndexLabel?: (song: SongListItem, index: number) => ReactNode;
  /** Group songs into sections by a shared key. Only contiguous songs with the same key are grouped together. */
  groupBy?: (song: SongListItem) => string | undefined;
  /** Render a custom header for a group. Receives the group key and the songs in the group. */
  renderGroupHeader?: (key: string, songs: SongListItem[]) => ReactNode;
}

export function SongTable({
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
}: SongTableProps) {
  const columns: TableColumn<SongListItem>[] = [
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
      render: (s) =>
        s.artistName ? (
          s.artistId ? (
            <Link href={`/artists/${s.artistId}`} className="hover:text-muted">
              {s.artistName}
            </Link>
          ) : (
            s.artistName
          )
        ) : (
          '-'
        ),
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
    render: (s) => (s.duration ? formatDuration(s.duration) : '-'),
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
