import { useMemo } from 'react';
import { Button } from '../ui/Button.js';
import { Field } from './Field.js';
import { CoverArtSection } from './CoverArtSection.js';
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
  const primaryFields = useMemo(() => fields.filter((f) => f.primary), [fields]);
  const secondaryFields = useMemo(() => fields.filter((f) => !f.primary), [fields]);
  return (
    <>
      <div className="flex flex-col gap-5 sm:flex-row">
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
        <TagFieldsGrid
          entityType="song"
          variant="primary"
          fields={primaryFields}
          values={values}
          onValueChange={onValueChange}
          explicit={explicit}
          onExplicitChange={onExplicitChange}
          isMulti={isMulti}
          readOnly={readOnly}
          albumStats={albumStats}
        />
      </div>

      <TagFieldsGrid
        entityType="song"
        variant="secondary"
        fields={secondaryFields}
        values={values}
        onValueChange={onValueChange}
        explicit={explicit}
        onExplicitChange={onExplicitChange}
        isMulti={isMulti}
        readOnly={readOnly}
        albumStats={albumStats}
      />

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
    </>
  );
}
