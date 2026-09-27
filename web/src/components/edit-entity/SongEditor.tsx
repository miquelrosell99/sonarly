import { Button } from '../ui/Button.js';
import { CoverArtSection } from './CoverArtSection.js';
import { EditorSection } from './EditorSection.js';
import { Field } from './Field.js';
import { TagFieldsGrid } from './TagFieldsGrid.js';
import { SONG_FIELDS } from './fields.js';

export interface SongEditorProps {
  entity?: Record<string, unknown>;
  entities?: Record<string, unknown>[];
  isMulti: boolean;
  readOnly?: boolean;
  values: Record<string, string | string[]>;
  onValueChange: (key: string, value: string | string[]) => void;
  explicit: boolean | null;
  onExplicitChange: (checked: boolean) => void;
  albumStats: { tracks: number; discs: number } | null;
  syncedLinesCount: number;
  coverArtBusy?: boolean;
  onEditCoverArt?: () => void;
  onDeleteCoverArt?: () => void;
  onEditSyncedLyrics?: () => void;
}

export function SongEditor({
  entity,
  entities,
  isMulti,
  readOnly,
  values,
  onValueChange,
  explicit,
  onExplicitChange,
  albumStats,
  syncedLinesCount,
  coverArtBusy,
  onEditCoverArt,
  onDeleteCoverArt,
  onEditSyncedLyrics,
}: SongEditorProps) {
  const fields = SONG_FIELDS;
  const coreFields = fields.filter((field) => field.group === 'core');
  const artistFields = fields.filter((field) => field.group === 'artists');
  const classificationFields = fields.filter((field) => field.group === 'classification');
  const sharedProps = {
    entityType: 'song' as const,
    values,
    onValueChange,
    explicit,
    onExplicitChange,
    isMulti,
    readOnly,
    albumStats,
  };
  return (
    <>
      <div className="flex flex-col gap-5 sm:flex-row">
        <EditorSection title="Artwork" className="shrink-0">
          <CoverArtSection
            entityType="song"
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
        <TagFieldsGrid {...sharedProps} title="Core metadata" fields={coreFields} className="flex-1" />
      </div>

      <TagFieldsGrid {...sharedProps} title="Artists & credits" fields={artistFields} />

      <TagFieldsGrid {...sharedProps} title="Classification" fields={classificationFields} />

      <EditorSection title="Lyrics">
        <div className="space-y-3">
          <Field label="Lyrics" htmlFor="edit-lyrics">
            <textarea
              id="edit-lyrics"
              value={String(values.lyrics ?? '')}
              onChange={(e) => onValueChange('lyrics', e.target.value)}
              placeholder="Add lyrics..."
              rows={5}
              disabled={readOnly}
              className="input w-full resize-none py-2 align-top !h-auto min-h-[8rem]"
            />
          </Field>

          <div className="flex items-center justify-between rounded-lg border border-rule bg-surface px-4 py-3">
            <span className="text-sm text-fg-secondary">
              {syncedLinesCount} synced lines
            </span>
            {!readOnly && !isMulti && (
              <Button variant="ghost" onClick={onEditSyncedLyrics}>
                Edit Synced Lyrics
              </Button>
            )}
          </div>
        </div>
      </EditorSection>
    </>
  );
}
