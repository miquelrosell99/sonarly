import { ArtistImage } from '../ArtistImage.js';
import { Input } from '../ui/Input.js';
import { Field, ReadOnlyValue } from './Field.js';

interface ArtistEditorProps {
  entity?: Record<string, unknown>;
  entities?: Record<string, unknown>[];
  readOnly?: boolean;
  values: Record<string, string | string[]>;
  onValueChange: (key: string, value: string | string[]) => void;
}

export function ArtistEditor({ entity, entities, readOnly, values, onValueChange }: ArtistEditorProps) {
  const activeEntities = entities && entities.length > 0 ? entities : entity ? [entity] : [];
  return (
    <div className="flex items-start gap-5">
      <ArtistImage
        artistId={String(activeEntities[0]?.id ?? entity?.id ?? '')}
        alt={String(values.name || 'Artist')}
        className="h-40 w-40 rounded-xl"
        iconSize={40}
      />
      <div className="flex-1">
        <Field label="Name" htmlFor="edit-name">
          {readOnly ? (
            <ReadOnlyValue>{values.name}</ReadOnlyValue>
          ) : (
            <Input
              id="edit-name"
              value={String(values.name ?? '')}
              onChange={(e) => onValueChange('name', e.target.value)}
              placeholder="Name"
            />
          )}
        </Field>
      </div>
    </div>
  );
}
