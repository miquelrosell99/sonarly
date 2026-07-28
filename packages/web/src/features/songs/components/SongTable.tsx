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
  renderRow?: (song: SongListItem, row: React.ReactNode) => React.ReactNode;
  empty?: React.ReactNode;
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
    />
  );
}
