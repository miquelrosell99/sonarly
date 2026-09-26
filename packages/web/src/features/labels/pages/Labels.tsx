import { Link } from 'wouter';
import { LibraryView, type LibraryViewColumn, type LibraryViewCardField } from '../../../components/LibraryView.js';
import { useLibraryStore } from '../../../stores/libraryStore.js';
import { useAlbumsList } from '../../../hooks/useLibraryLists.js';

export function Labels() {
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
  const { data, isLoading, error, refetch } = useAlbumsList({ libraryId: selectedLibraryId });
  const albums = data?.albums ?? [];

  const labelNames = (album: (typeof albums)[number]) => album.labelEntries?.map((entry) => entry.name) ?? [];

  const labels = Array.from(
    new Set(albums.flatMap((album) => labelNames(album))),
  ).sort((a, b) => a.localeCompare(b));

  const columns: LibraryViewColumn<string>[] = [
    {
      key: 'name',
      header: 'Label',
      render: (label) => (
        <Link href={`/labels/${encodeURIComponent(label)}`} className="hover:text-muted">
          {label}
        </Link>
      ),
    },
  ];

  const cardFields: LibraryViewCardField<string>[] = [
    { key: 'name', render: (label) => label },
  ];

  return (
    <LibraryView
      title="Labels"
      data={labels}
      isLoading={isLoading}
      error={error?.message ?? null}
      columns={columns}
      cardFields={cardFields}
      getId={(label) => label}
      getHref={(label) => `/labels/${encodeURIComponent(label)}`}
      emptyMessage="No labels found."
      onRetry={() => void refetch()}
      defaultView="list"
    />
  );
}
