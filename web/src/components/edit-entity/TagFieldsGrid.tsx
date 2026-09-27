import { Checkbox } from '../ui/Checkbox.js';
import { PillInput } from '../ui/PillInput.js';
import { Field } from './Field.js';
import { TagInput } from './TagInput.js';
import type { TagField } from './fields.js';

export interface TagFieldsGridProps {
  entityType: 'song' | 'album';
  variant: 'primary' | 'secondary';
  fields: TagField[];
  values: Record<string, string | string[]>;
  onValueChange: (key: string, value: string | string[]) => void;
  explicit: boolean | null;
  onExplicitChange: (checked: boolean) => void;
  isMulti: boolean;
  readOnly?: boolean;
  albumStats: { tracks: number; discs: number } | null;
}

export function TagFieldsGrid({
  entityType,
  variant,
  fields,
  values,
  onValueChange,
  explicit,
  onExplicitChange,
  isMulti,
  readOnly,
  albumStats,
}: TagFieldsGridProps) {
  if (variant === 'primary') {
    return (
      <div className="grid flex-1 gap-4 sm:grid-cols-2">
        {fields.map(({ key, label, type, autocomplete, multi }) => (
          <Field
            key={key}
            label={label}
            htmlFor={`edit-${key}`}
            className={key === 'title' || key === 'album' ? 'sm:col-span-2' : undefined}
          >
            {key === 'title' && entityType === 'song' ? (
              <div className="flex items-center gap-4">
                <TagInput
                  id={`edit-${key}`}
                  value={String(values[key] ?? '')}
                  onChange={(value) => onValueChange(key, value)}
                  type={type}
                  autocomplete={autocomplete}
                  placeholder={label}
                  disabled={readOnly}
                  className="flex-1"
                />
                <Checkbox
                  id="edit-explicit"
                  label="Explicit"
                  checked={explicit ?? false}
                  indeterminate={explicit === null}
                  onChange={(e) => onExplicitChange(e.target.checked)}
                  disabled={readOnly}
                />
              </div>
            ) : multi ? (
              <PillInput
                id={`edit-${key}`}
                values={Array.isArray(values[key]) ? (values[key] as string[]) : []}
                onChange={(value) => onValueChange(key, value)}
                autocomplete={autocomplete}
                placeholder={label}
                disabled={readOnly}
              />
            ) : (
              <TagInput
                id={`edit-${key}`}
                value={String(values[key] ?? '')}
                onChange={(value) => onValueChange(key, value)}
                type={type}
                autocomplete={autocomplete}
                placeholder={label}
                disabled={readOnly}
                hint={
                  key === 'trackNumber' && albumStats && albumStats.tracks > 0
                    ? `Max track in album: ${albumStats.tracks}`
                    : key === 'discNumber' && albumStats && albumStats.discs > 0
                      ? `Max disc in album: ${albumStats.discs}`
                      : undefined
                }
              />
            )}
          </Field>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {fields.map(({ key, label, type, autocomplete, multi }) => (
        <Field
          key={key}
          label={label}
          htmlFor={`edit-${key}`}
          className={
            key === 'artist'
              ? 'col-span-2 sm:col-span-4'
              : key === 'genre' || key === 'year'
                ? 'col-span-2'
                : 'col-span-1'
          }
        >
          {multi ? (
            <PillInput
              id={`edit-${key}`}
              values={Array.isArray(values[key]) ? (values[key] as string[]) : []}
              onChange={(value) => onValueChange(key, value)}
              autocomplete={autocomplete}
              placeholder={label}
              disabled={readOnly}
            />
          ) : (
            <TagInput
              id={`edit-${key}`}
              value={String(values[key] ?? '')}
              onChange={(value) => onValueChange(key, value)}
              type={type}
              autocomplete={autocomplete}
              placeholder={label}
              disabled={readOnly}
            />
          )}
        </Field>
      ))}
    </div>
  );
}
