import { useEffect, useState, useMemo, useRef } from 'react';
import { Link } from 'wouter';
import type { Album, Song, User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Icon } from '../../../components/ui/Icon.js';
import { usePlayActions } from '../../../hooks/usePlayActions.js';
import { useFavoriteActions } from '../../../hooks/useFavoriteActions.js';
import { useDominantColor } from '../../../hooks/useDominantColor.js';
import { useLibraryStore, buildLibraryQuery } from '../../../stores/libraryStore.js';
import { usePlayer } from '../../../stores/playerStore.js';
import { useNotification } from '../../../contexts/NotificationContext.js';
import { ScrollRow } from '../../../components/ScrollRow.js';
import { Card } from '../../../components/Card.js';
import { CoverArt } from '../../../components/CoverArt.js';
import { ItemContextMenu } from '../../../components/ItemContextMenu.js';
import { EditEntityModal } from '../../../components/EditEntityModal.js';
import { useAlbumContextMenu } from '../../../hooks/useAlbumContextMenu.js';

interface HomeData {
  mostPlayed: Album[];
  random: Album[];
  recentlyAdded: Album[];
  recentlyPlayed: Album[];
}

interface AlbumDetail {
  album: Album;
  songs: Song[];
}

function AlbumCard({ album: initialAlbum, user }: { album: Album; user: User }) {
  const { playSongs, shufflePlay } = usePlayActions();
  const { setFavorite, setRating } = useFavoriteActions();
  const { notify } = useNotification();
  const currentAlbumId = usePlayer((state) => state.currentSong?.albumId);
  const [album, setAlbum] = useState(initialAlbum);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [coverArtBusy, setCoverArtBusy] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const baseSections = useAlbumContextMenu(album);
  const contextMenuSections = user.isAdmin
    ? [...baseSections, { items: [{ id: 'edit', label: 'Edit', icon: 'mdi-pencil', onClick: () => setEditing(true) }] }]
    : baseSections;

  const handlePlay = async () => {
    setError(null);
    try {
      const detail = await api<AlbumDetail>(`/albums/${album.id}${buildLibraryQuery(selectedLibraryId)}`);
      playSongs(detail.songs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to play album');
    }
  };

  const handleShufflePlay = async () => {
    setError(null);
    try {
      const detail = await api<AlbumDetail>(`/albums/${album.id}${buildLibraryQuery(selectedLibraryId)}`);
      shufflePlay(detail.songs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to shuffle play album');
    }
  };

  const handleFavorite = async (starred: boolean) => {
    setError(null);
    try {
      await setFavorite('album', album.id, starred);
      setAlbum((prev) => ({ ...prev, starred }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update favorite');
    }
  };

  const handleRate = async (rating: number) => {
    setError(null);
    try {
      await setRating('album', album.id, rating || undefined);
      setAlbum((prev) => ({ ...prev, rating: rating || undefined }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rating');
    }
  };

  const handleSave = async (patched: Record<string, unknown>) => {
    setSaving(true);
    try {
      await api(`/albums/${album.id}/tags`, {
        method: 'PUT',
        body: JSON.stringify(patched),
      });
      setEditing(false);
      setAlbum((prev) => ({
        ...prev,
        name: typeof patched.title === 'string' ? patched.title : prev.name,
        artistName: typeof patched.albumArtist === 'string' ? patched.albumArtist : prev.artistName,
        year: typeof patched.year === 'number' ? patched.year : prev.year,
      }));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save album', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api(`/albums/${album.id}`, { method: 'DELETE' });
      setEditing(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete album', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleEditCoverArt = () => {
    coverInputRef.current?.click();
  };

  const handleCoverArtFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverArtBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api(`/albums/${album.id}/cover-art`, {
        method: 'POST',
        body: formData,
      });
      setAlbum((prev) => ({ ...prev, coverArt: `${Date.now()}` }));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update cover art', 'error');
    } finally {
      setCoverArtBusy(false);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  const handleDeleteCoverArt = async () => {
    setCoverArtBusy(true);
    try {
      await api(`/albums/${album.id}/cover-art`, { method: 'DELETE' });
      setAlbum((prev) => ({ ...prev, coverArt: undefined }));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to remove cover art', 'error');
    } finally {
      setCoverArtBusy(false);
    }
  };

  const editEntity = editing
    ? {
        ...album,
        title: album.name,
        albumArtist: album.artistName,
      }
    : null;

  return (
    <div>
      <ItemContextMenu sections={contextMenuSections}>
        <Card
          href={`/albums/${album.id}`}
          title={album.name}
          fields={[
          {
            content: (
              <span>
                {album.artistId ? (
                  <Link href={`/artists/${album.artistId}`} className="hover:text-muted">
                    {album.artistName ?? 'Unknown artist'}
                  </Link>
                ) : (
                  album.artistName ?? '-'
                )}
                {album.year !== undefined && album.year !== null && (
                  <>
                    {' • '}
                    <Link href={`/years/${album.year}`} className="hover:text-muted">
                      {album.year}
                    </Link>
                  </>
                )}
              </span>
            ),
          },
        ]}
        cover={
          <CoverArt
            coverArt={album.coverArt}
            alt={`Cover art for ${album.name}`}
            className="rounded-xl"
          />
        }
        favorite={{
          starred: album.starred,
          onClick: () => handleFavorite(!album.starred),
          label: album.name,
        }}
        rating={{
          value: album.rating,
          onRate: handleRate,
        }}
        play={{
          onPlay: handlePlay,
          onShufflePlay: handleShufflePlay,
          label: album.name,
        }}
        isPlaying={currentAlbumId === album.id}
      />
      </ItemContextMenu>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {editEntity && (
        <EditEntityModal
          open
          entityType="album"
          entity={editEntity}
          onClose={() => setEditing(false)}
          onSave={handleSave}
          onDelete={handleDelete}
          onEditCoverArt={handleEditCoverArt}
          onDeleteCoverArt={handleDeleteCoverArt}
          saving={saving}
          deleting={deleting}
          coverArtBusy={coverArtBusy}
        />
      )}
      <input
        ref={coverInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleCoverArtFileChange}
      />
    </div>
  );
}

interface FeaturedAlbumSlideProps {
  album: Album;
}

function FeaturedAlbumSlide({ album }: FeaturedAlbumSlideProps) {
  const { playSongs } = usePlayActions();
  const [loading, setLoading] = useState(false);
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);

  const handlePlay = async () => {
    setLoading(true);
    try {
      const detail = await api<AlbumDetail>(`/albums/${album.id}${buildLibraryQuery(selectedLibraryId)}`);
      playSongs(detail.songs);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative z-10 flex w-full shrink-0 flex-col gap-6 md:flex-row md:items-end">
      <div className="shrink-0 overflow-hidden rounded-2xl shadow-2xl shadow-black/30 md:w-64 lg:w-72">
        <CoverArt
          coverArt={album.coverArt}
          alt={`Cover art for ${album.name}`}
          iconSize={64}
          className="rounded-2xl"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-fg-secondary">
          Featured album
        </span>
        <h1 className="font-display text-4xl font-bold tracking-tight text-fg-primary md:text-5xl lg:text-6xl">
          <Link href={`/albums/${album.id}`} className="hover:text-muted">
            {album.name}
          </Link>
        </h1>
        <p className="text-lg text-fg-secondary">
          {album.artistId ? (
            <Link href={`/artists/${album.artistId}`} className="hover:text-muted">
              {album.artistName ?? 'Unknown artist'}
            </Link>
          ) : (
            album.artistName ?? 'Unknown artist'
          )}
          {album.year !== undefined && album.year !== null && (
            <>
              {' • '}
              <Link href={`/years/${album.year}`} className="hover:text-muted">
                {album.year}
              </Link>
            </>
          )}
          {album.genre && (
            <>
              {' • '}
              <Link href={`/genres/${encodeURIComponent(album.genre)}`} className="hover:text-muted">
                {album.genre}
              </Link>
            </>
          )}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handlePlay}
            disabled={loading}
            className="btn h-12 px-8 text-base"
          >
            <Icon name="mdi-play" size={22} />
            {loading ? 'Loading…' : 'Play'}
          </button>
          <Link
            href={`/albums/${album.id}`}
            className="btn-ghost h-12 px-8 text-base hover:text-fg-primary"
          >
            View album
          </Link>
        </div>
      </div>
    </div>
  );
}

function FeaturedAlbum({ albums }: { albums: Album[] }) {
  const [index, setIndex] = useState(0);
  const [transitionEnabled, setTransitionEnabled] = useState(true);

  const hasMultiple = albums.length > 1;
  const slides = hasMultiple ? [...albums, albums[0]] : albums;
  const activeDotIndex = index >= albums.length ? 0 : index;
  const album = slides[index];
  const coverUrl = album?.coverArt ? `/api/cover-art/${album.coverArt}` : undefined;
  const dominantColor = useDominantColor(coverUrl);

  useEffect(() => {
    setIndex(0);
    setTransitionEnabled(true);
  }, [albums.map((a) => a.id).join(',')]);

  useEffect(() => {
    if (!hasMultiple) return undefined;
    const timer = setInterval(() => {
      setIndex((current) => (current >= albums.length ? current : current + 1));
    }, 5000);
    return () => clearInterval(timer);
  }, [hasMultiple, albums.length]);

  useEffect(() => {
    if (!hasMultiple || index !== albums.length) return undefined;
    const timeout = setTimeout(() => {
      setTransitionEnabled(false);
      setIndex(0);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTransitionEnabled(true);
        });
      });
    }, 500);
    return () => clearTimeout(timeout);
  }, [index, albums.length, hasMultiple]);

  if (!album) return null;

  return (
    <section
      className="relative mb-8 overflow-hidden rounded-3xl px-6 pb-6 pt-6"
      style={
        dominantColor
          ? ({
              background: `radial-gradient(circle at 70% 30%, ${dominantColor}22 0%, transparent 60%)`,
              transition: 'background 0.5s ease',
            } as React.CSSProperties)
          : undefined
      }
    >
      <div className="overflow-hidden">
        <div
          className={`flex ${
            transitionEnabled ? 'motion-reduce:transition-none transition-transform duration-500 ease-out' : ''
          }`}
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {slides.map((album, i) => (
            <FeaturedAlbumSlide key={`${album.id}-${i}`} album={album} />
          ))}
        </div>
      </div>
      {hasMultiple && (
        <div className="mt-6 flex items-center gap-2">
          {albums.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Go to featured album ${i + 1}`}
              className={`h-2 rounded-full transition-all ${
                i === activeDotIndex ? 'w-6 bg-accent' : 'w-2 bg-fg-secondary/40 hover:bg-fg-secondary/70'
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function HomePage({ user }: { user: User }) {
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);

  useEffect(() => {
    api<HomeData>(`/home${buildLibraryQuery(selectedLibraryId)}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load home'))
      .finally(() => setLoading(false));
  }, [selectedLibraryId]);

  const featuredAlbums = useMemo(() => {
    if (!data) return [];
    const candidates: Album[] = [];
    const seen = new Set<string>();
    const add = (album: Album | undefined) => {
      if (!album || seen.has(album.id)) return;
      seen.add(album.id);
      candidates.push(album);
    };
    add(data.mostPlayed[0]);
    add(data.recentlyPlayed[0]);
    add(data.recentlyAdded[0]);
    add(data.random[0]);
    return candidates;
  }, [data]);

  if (loading) {
    return <p className="p-6 text-sm text-fg-secondary">Loading…</p>;
  }

  if (error) {
    return <p className="p-6 text-sm text-danger">{error}</p>;
  }

  if (!data) {
    return <p className="p-6 text-sm text-fg-secondary">No data available.</p>;
  }

  return (
    <div className="space-y-10 p-6">
      {featuredAlbums.length > 0 && <FeaturedAlbum albums={featuredAlbums} />}

      <ScrollRow title="Most played">
        {data.mostPlayed.length === 0 ? (
          <p className="text-sm text-fg-secondary">No played albums yet.</p>
        ) : (
          data.mostPlayed.map((album) => (
            <div key={album.id} className="w-40 flex-none sm:w-44">
              <AlbumCard album={album} user={user} />
            </div>
          ))
        )}
      </ScrollRow>

      <ScrollRow title="Random albums">
        {data.random.length === 0 ? (
          <p className="text-sm text-fg-secondary">No albums found.</p>
        ) : (
          data.random.map((album) => (
            <div key={album.id} className="w-40 flex-none sm:w-44">
              <AlbumCard album={album} user={user} />
            </div>
          ))
        )}
      </ScrollRow>

      <ScrollRow title="Recently added">
        {data.recentlyAdded.length === 0 ? (
          <p className="text-sm text-fg-secondary">No recently added albums.</p>
        ) : (
          data.recentlyAdded.map((album) => (
            <div key={album.id} className="w-40 flex-none sm:w-44">
              <AlbumCard album={album} user={user} />
            </div>
          ))
        )}
      </ScrollRow>

      <ScrollRow title="Recently played">
        {data.recentlyPlayed.length === 0 ? (
          <p className="text-sm text-fg-secondary">No recently played albums.</p>
        ) : (
          data.recentlyPlayed.map((album) => (
            <div key={album.id} className="w-40 flex-none sm:w-44">
              <AlbumCard album={album} user={user} />
            </div>
          ))
        )}
      </ScrollRow>
    </div>
  );
}
