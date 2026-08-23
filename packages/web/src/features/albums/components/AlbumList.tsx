import { Link } from 'wouter';
import type { Album } from '@sonarly/shared';

interface AlbumWithArtist extends Album {
  artistName?: string;
}

interface AlbumListProps {
  albums: AlbumWithArtist[];
  showYear?: boolean;
  showArtist?: boolean;
  empty?: React.ReactNode;
}

export function AlbumList({
  albums,
  showYear = true,
  showArtist = true,
  empty,
}: AlbumListProps) {
  if (albums.length === 0) {
    return empty ? <>{empty}</> : null;
  }

  return (
    <ul className="divide-y divide-rule">
      {albums.map((album) => (
        <li key={album.id}>
          <Link
            href={`/albums/${album.id}`}
            className="flex min-h-11 items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-surface-hover"
          >
            <span>{album.name}</span>
            <span className="text-muted">
              {showArtist && (album.artistName ?? '-')}
              {showYear && album.year !== undefined && album.year !== null && (
                <>
                  {' • '}
                  <span className="font-mono tabular-nums">{album.year}</span>
                </>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
