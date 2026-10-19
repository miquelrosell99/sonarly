import { CoverArtSection } from './CoverArtSection.js';
import { EditorSection } from './EditorSection.js';
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
  const coreFields = fields.filter((field) => field.group === 'core');
  const artistFields = fields.filter((field) => field.group === 'artists');
  const classificationFields = fields.filter((field) => field.group === 'classification');
  const sharedProps = {
    entityType: 'album' as const,
    values,
    onValueChange,
    explicit: null,
    onExplicitChange: () => undefined,
    isMulti,
    readOnly,
    albumStats,
  };
  return (
    <>
      <div className="flex flex-col gap-5 sm:flex-row">
        <TagFieldsGrid {...sharedProps} title="Core metadata" fields={coreFields} className="flex-1" />
        <EditorSection title="Artwork" className="shrink-0">
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
        </EditorSection>
      </div>

      <TagFieldsGrid {...sharedProps} title="Artists & credits" fields={artistFields} />

      <TagFieldsGrid {...sharedProps} title="Classification" fields={classificationFields} />
    </>
  );
}
