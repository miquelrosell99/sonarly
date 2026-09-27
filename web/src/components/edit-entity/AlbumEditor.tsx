import { useMemo } from 'react';
import { CoverArtSection } from './CoverArtSection.js';
import { TagFieldsGrid } from './TagFieldsGrid.js';
import { ALBUM_FIELDS } from './fields.js';

export interface AlbumEditorProps {
  entity?: Record<string, unknown>;
  entities?: Record<string, unknown>[];
  isMulti: boolean;
  readOnly?: boolean;
  values: Record<string, string | string[]>;
  onValueChange: (key: string, value: string | string[]) => void;
  albumStats: { tracks: number; discs: number } | null;
  coverArtBusy?: boolean;
  onEditCoverArt?: () => void;
  onDeleteCoverArt?: () => void;
}

export function AlbumEditor({
  entity,
  entities,
  isMulti,
  readOnly,
  values,
  onValueChange,
  albumStats,
  coverArtBusy,
  onEditCoverArt,
  onDeleteCoverArt,
}: AlbumEditorProps) {
  const fields = ALBUM_FIELDS;
  const primaryFields = useMemo(() => fields.filter((f) => f.primary), [fields]);
  const secondaryFields = useMemo(() => fields.filter((f) => !f.primary), [fields]);
  return (
    <>
      <div className="flex flex-col gap-5 sm:flex-row">
        <CoverArtSection
          entityType="album"
          entity={entity}
          entities={entities}
          isMulti={isMulti}
          title={values.title}
          readOnly={readOnly}
          coverArtBusy={coverArtBusy}
          onEditCoverArt={onEditCoverArt}
          onDeleteCoverArt={onDeleteCoverArt}
        />
        <TagFieldsGrid
          entityType="album"
          variant="primary"
          fields={primaryFields}
          values={values}
          onValueChange={onValueChange}
          explicit={null}
          onExplicitChange={() => undefined}
          isMulti={isMulti}
          readOnly={readOnly}
          albumStats={albumStats}
        />
      </div>

      <TagFieldsGrid
        entityType="album"
        variant="secondary"
        fields={secondaryFields}
        values={values}
        onValueChange={onValueChange}
        explicit={null}
        onExplicitChange={() => undefined}
        isMulti={isMulti}
        readOnly={readOnly}
        albumStats={albumStats}
      />
    </>
  );
}
