import type { ReactNode } from 'react';
import type { StatisticsRatedLists } from '../../../../types';
import { Icon } from '../../../../components/ui/Icon.js';
import { SectionCard, ShowMoreButton } from './SectionCard.js';
import { ArtistAvatar, TopListRow } from './TopLists.js';
import { useCollapsed } from './useCollapsed.js';
import { formatNumber, formatRating } from './format.js';

export function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="text-sm text-on-surface-variant">{children}</p>;
}

export function TopRatedArtists({ artists, stagger }: { artists: StatisticsRatedLists['topRatedArtists']; stagger: number }) {
  const { expanded, limit, toggle } = useCollapsed();
  const max = artists.length > 0 ? Math.max(...artists.map((a) => a.ratedSongs)) : 0;
  return (
    <SectionCard icon="mdi-account-star" title="Top Rated Artists" stagger={stagger}>
      {artists.length === 0 ? (
        <EmptyHint>Rate at least 2 songs by an artist to see this list.</EmptyHint>
      ) : (
        <>
          <div className="space-y-1">
            {artists.slice(0, limit).map((artist, index) => (
              <TopListRow
                key={artist.artistId ?? artist.artistName}
                href={artist.artistId ? `/artists/${artist.artistId}` : '#'}
                rank={index + 1}
                proportion={max > 0 ? artist.ratedSongs / max : 0}
                title={artist.artistName}
                subtitle={`${formatNumber(artist.ratedSongs)} rated songs`}
                image={<ArtistAvatar artistId={artist.artistId} artistName={artist.artistName} />}
                value={`${formatRating(artist.averageRating)}/5`}
              />
            ))}
          </div>
          <ShowMoreButton expanded={expanded} onClick={toggle} count={artists.length} />
        </>
      )}
    </SectionCard>
  );
}

export function TopRatedGenres({ genres, stagger }: { genres: StatisticsRatedLists['topRatedGenres']; stagger: number }) {
  const { expanded, limit, toggle } = useCollapsed();
  const max = genres.length > 0 ? Math.max(...genres.map((g) => g.ratedSongs)) : 0;
  return (
    <SectionCard icon="mdi-tag-multiple" title="Top Rated Genres" stagger={stagger}>
      {genres.length === 0 ? (
        <EmptyHint>Rate at least 2 songs in a genre to see this list.</EmptyHint>
      ) : (
        <>
          <div className="space-y-1">
            {genres.slice(0, limit).map((genre, index) => (
              <TopListRow
                key={genre.genre}
                href={`/genres/${encodeURIComponent(genre.genre)}`}
                rank={index + 1}
                proportion={max > 0 ? genre.ratedSongs / max : 0}
                title={genre.genre}
                subtitle={`${formatNumber(genre.ratedSongs)} rated songs`}
                image={
                  <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-item bg-surface-container-high">
                    <Icon name="mdi-tag" size={20} className="text-on-surface-variant" />
                  </span>
                }
                value={`${formatRating(genre.averageRating)}/5`}
              />
            ))}
          </div>
          <ShowMoreButton expanded={expanded} onClick={toggle} count={genres.length} />
        </>
      )}
    </SectionCard>
  );
}

export function TopRatedYears({ years, stagger }: { years: StatisticsRatedLists['topRatedYears']; stagger: number }) {
  const { expanded, limit, toggle } = useCollapsed();
  if (years.length === 0) return null;
  const max = Math.max(...years.map((y) => y.ratedSongs));
  return (
    <SectionCard icon="mdi-calendar-clock" title="Top Rated Years" stagger={stagger}>
      <div className="space-y-1">
        {years.slice(0, limit).map((year, index) => (
          <TopListRow
            key={year.year}
            href={`/years/${year.year}`}
            rank={index + 1}
            proportion={max > 0 ? year.ratedSongs / max : 0}
            title={String(year.year)}
            subtitle={`${formatNumber(year.ratedSongs)} rated songs`}
            image={
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-item bg-surface-container-high">
                <Icon name="mdi-calendar-clock" size={20} className="text-on-surface-variant" />
              </span>
            }
            value={`${formatRating(year.averageRating)}/5`}
          />
        ))}
      </div>
      <ShowMoreButton expanded={expanded} onClick={toggle} count={years.length} />
    </SectionCard>
  );
}
