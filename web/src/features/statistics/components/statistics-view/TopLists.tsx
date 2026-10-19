import type { ReactNode } from 'react';
import { Link } from 'wouter';
import type { StatisticsTopLists, TopYearItem } from '../../../../types';
import { cn } from '../../../../lib/cn.js';
import { Icon } from '../../../../components/ui/Icon.js';
import { CoverArt } from '../../../../components/CoverArt.js';
import { ArtistImage } from '../../../../components/ArtistImage.js';
import { SectionCard, ShowMoreButton } from './SectionCard.js';
import { useCollapsed } from './useCollapsed.js';
import { formatNumber, staggerStyle } from './format.js';

function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        'relative w-6 shrink-0 text-center font-mono text-sm font-semibold tabular-nums',
        rank <= 3 ? 'text-on-surface' : 'text-on-surface-variant',
      )}
    >
      {rank}
    </span>
  );
}

export function TopListRow({
  href,
  rank,
  proportion,
  title,
  subtitle,
  image,
  value,
}: {
  href: string;
  rank: number;
  proportion: number;
  title: string;
  subtitle?: string;
  image: ReactNode;
  value: string;
}) {
  return (
    <Link
      href={href}
      className="group/row relative flex items-center gap-3 overflow-hidden rounded-item p-2 transition hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 rounded-item bg-primary/[0.07]"
        style={{ width: `${Math.max(0, Math.min(100, proportion * 100))}%` }}
      />
      <RankBadge rank={rank} />
      {image}
      <div className="relative min-w-0 flex-1">
        <p className="truncate font-medium text-on-surface">{title}</p>
        {subtitle && <p className="truncate text-xs text-on-surface-variant">{subtitle}</p>}
      </div>
      <span className="relative font-mono text-sm font-semibold text-on-surface-variant tabular-nums transition group-hover/row:text-on-surface">
        {value}
      </span>
    </Link>
  );
}

export function ArtistAvatar({ artistId, artistName }: { artistId?: string; artistName: string }) {
  if (artistId) {
    return (
      <ArtistImage
        artistId={artistId}
        alt={artistName}
        className="relative h-10 w-10"
        shape="circle"
        iconSize={20}
      />
    );
  }
  return (
    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container-high">
      <Icon name="mdi-account-music" size={20} className="text-on-surface-variant" />
    </div>
  );
}

export function TopSongs({ songs, stagger }: { songs: StatisticsTopLists['topSongs']; stagger: number }) {
  const { expanded, limit, toggle } = useCollapsed();
  if (songs.length === 0) return null;
  const max = Math.max(...songs.map((s) => s.plays));
  return (
    <SectionCard icon="mdi-fire" title="Top Songs" stagger={stagger}>
      <div className="space-y-1">
        {songs.slice(0, limit).map((song, index) => (
          <TopListRow
            key={song.songId}
            href={`/tracks/${song.songId}`}
            rank={index + 1}
            proportion={max > 0 ? song.plays / max : 0}
            title={song.title}
            subtitle={song.artistName ?? '-'}
            image={
              <CoverArt
                coverArt={song.albumCoverArt}
                alt={song.title}
                className="relative h-10 w-10 rounded-item"
                iconSize={20}
              />
            }
            value={formatNumber(song.plays)}
          />
        ))}
      </div>
      <ShowMoreButton expanded={expanded} onClick={toggle} count={songs.length} />
    </SectionCard>
  );
}

export function TopArtists({ artists, stagger }: { artists: StatisticsTopLists['topArtists']; stagger: number }) {
  const { expanded, limit, toggle } = useCollapsed();
  if (artists.length === 0) return null;
  const max = Math.max(...artists.map((a) => a.plays));
  return (
    <SectionCard icon="mdi-trophy" title="Top Artists" stagger={stagger}>
      <div className="space-y-1">
        {artists.slice(0, limit).map((artist, index) => (
          <TopListRow
            key={artist.artistId ?? artist.artistName}
            href={artist.artistId ? `/artists/${artist.artistId}` : '#'}
            rank={index + 1}
            proportion={max > 0 ? artist.plays / max : 0}
            title={artist.artistName}
            image={<ArtistAvatar artistId={artist.artistId} artistName={artist.artistName} />}
            value={formatNumber(artist.plays)}
          />
        ))}
      </div>
      <ShowMoreButton expanded={expanded} onClick={toggle} count={artists.length} />
    </SectionCard>
  );
}

export function TopAlbums({ albums, stagger }: { albums: StatisticsTopLists['topAlbums']; stagger: number }) {
  const { expanded, limit, toggle } = useCollapsed();
  if (albums.length === 0) return null;
  const max = Math.max(...albums.map((a) => a.plays));
  return (
    <SectionCard icon="mdi-album" title="Top Albums" stagger={stagger}>
      <div className="space-y-1">
        {albums.slice(0, limit).map((album, index) => (
          <TopListRow
            key={album.albumId ?? album.albumName}
            href={album.albumId ? `/albums/${album.albumId}` : '#'}
            rank={index + 1}
            proportion={max > 0 ? album.plays / max : 0}
            title={album.albumName}
            subtitle={album.artistName ?? '-'}
            image={
              <CoverArt
                coverArt={album.coverArt}
                alt={album.albumName}
                className="relative h-10 w-10 rounded-item"
                iconSize={20}
              />
            }
            value={formatNumber(album.plays)}
          />
        ))}
      </div>
      <ShowMoreButton expanded={expanded} onClick={toggle} count={albums.length} />
    </SectionCard>
  );
}

export function GenreChart({ genres, stagger }: { genres: StatisticsTopLists['topGenres']; stagger: number }) {
  const { expanded, limit, toggle } = useCollapsed();
  if (genres.length === 0) return null;
  const max = Math.max(...genres.map((g) => g.plays));
  return (
    <SectionCard icon="mdi-chart-pie" title="Top Genres" stagger={stagger}>
      <div className="space-y-1">
        {genres.slice(0, limit).map((genre, index) => (
          <div key={genre.genre} className="group -mx-2 space-y-1.5 rounded-item px-2 py-2 transition hover:bg-surface-container-high">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium text-on-surface">{genre.genre}</span>
              <span className="font-mono text-on-surface-variant tabular-nums transition group-hover:text-on-surface">
                {formatNumber(genre.plays)}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-container-high">
              <div
                className="stat-grow-x h-full rounded-full transition group-hover:brightness-110"
                style={{
                  width: `${max > 0 ? (genre.plays / max) * 100 : 0}%`,
                  background: 'hsl(var(--md-sys-color-primary))',
                  ...staggerStyle(index),
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <ShowMoreButton expanded={expanded} onClick={toggle} count={genres.length} />
    </SectionCard>
  );
}

export function TopPlayedYears({ years, stagger }: { years: TopYearItem[]; stagger: number }) {
  const { expanded, limit, toggle } = useCollapsed();
  if (years.length === 0) return null;
  const max = Math.max(...years.map((y) => y.plays));
  return (
    <SectionCard icon="mdi-calendar-clock" title="Top Years" stagger={stagger}>
      <div className="space-y-1">
        {years.slice(0, limit).map((year, index) => (
          <Link
            key={year.year}
            href={`/years/${year.year}`}
            className="group flex items-center justify-between gap-3 rounded-item p-2 transition hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="font-mono font-medium text-on-surface tabular-nums">{year.year}</span>
            <div className="flex items-center gap-3">
              <div className="h-2.5 w-24 overflow-hidden rounded-full bg-surface-container-high sm:w-32">
                <div
                  className="stat-grow-x h-full rounded-full transition group-hover:brightness-110"
                  style={{
                    width: `${max > 0 ? (year.plays / max) * 100 : 0}%`,
                    background: 'hsl(var(--md-sys-color-primary))',
                    ...staggerStyle(index),
                  }}
                />
              </div>
              <span className="w-10 text-right font-mono text-sm text-on-surface-variant tabular-nums transition group-hover:text-on-surface">
                {formatNumber(year.plays)}
              </span>
            </div>
          </Link>
        ))}
      </div>
      <ShowMoreButton expanded={expanded} onClick={toggle} count={years.length} />
    </SectionCard>
  );
}
