import { Link } from 'wouter';
import type { Song } from '@sonarly/shared';
import { formatDuration } from '../../../lib/format.js';
import type { SongWithNames } from '../../../lib/types.js';

type Track = SongWithNames | Song;

interface TrackListProps {
  tracks: Track[];
  showArtist?: boolean;
  showAlbum?: boolean;
  showDuration?: boolean;
  onItemClick?: (track: Track) => void;
  empty?: React.ReactNode;
}

export function TrackList({
  tracks,
  showArtist = true,
  showAlbum = false,
  showDuration = true,
  onItemClick,
  empty,
}: TrackListProps) {
  if (tracks.length === 0) {
    return empty ? <>{empty}</> : null;
  }

  return (
    <ul className="divide-y divide-rule">
      {tracks.map((track) => {
        const artistName = 'artistName' in track ? track.artistName : undefined;
        const albumName = 'albumName' in track ? track.albumName : undefined;
        const details: string[] = [];
        if (showArtist && artistName) details.push(artistName);
        if (showAlbum && albumName) details.push(albumName);

        const content = (
          <>
            <span>{track.title}</span>
            {(details.length > 0 || (showDuration && track.duration)) && (
              <span className="text-muted">
                {details.join(' • ')}
                {showDuration && track.duration !== undefined && (
                  <>
                    {details.length > 0 && ' • '}
                    <span className="font-mono tabular-nums">{formatDuration(track.duration)}</span>
                  </>
                )}
              </span>
            )}
          </>
        );

        return (
          <li key={track.id}>
            {onItemClick ? (
              <button
                type="button"
                onClick={() => onItemClick(track)}
                className="flex min-h-11 w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-surface-hover"
              >
                {content}
              </button>
            ) : (
              <Link
                href={`/tracks/${track.id}`}
                className="flex min-h-11 items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-surface-hover"
              >
                {content}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
