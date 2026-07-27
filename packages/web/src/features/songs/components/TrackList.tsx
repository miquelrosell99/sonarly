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
        if (showDuration && track.duration) details.push(formatDuration(track.duration));

        const content = (
          <>
            <span>{track.title}</span>
            {details.length > 0 && <span className="text-muted">{details.join(' • ')}</span>}
          </>
        );

        return (
          <li key={track.id}>
            {onItemClick ? (
              <button
                type="button"
                onClick={() => onItemClick(track)}
                className="flex w-full items-center justify-between py-2 text-left text-sm hover:bg-surface-hover"
              >
                {content}
              </button>
            ) : (
              <Link
                href={`/tracks/${track.id}`}
                className="flex items-center justify-between py-2 text-sm hover:bg-surface-hover"
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
