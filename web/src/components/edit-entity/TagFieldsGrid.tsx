import { cn } from '../../lib/cn.js';
import { Checkbox } from '../ui/Checkbox.js';
import { Field } from './Field.js';
import { EditorSection } from './EditorSection.js';
import { TagInput } from './TagInput.js';
import { SortablePillInput } from './SortablePillInput.js';
import type { TagField } from './fields.js';

export interface TagFieldsGridProps {
  entityType: 'song' | 'album';
  /** Section heading rendered above the grid (EditorSection). */
  title: string;
  fields: TagField[];
  values: Record<string, string | string[]>;
  onValueChange: (key: string, value: string | string[]) => void;
  explicit: boolean | null;
  onExplicitChange: (checked: boolean) => void;
  isMulti: boolean;
  readOnly?: boolean;
  albumStats: { tracks: number; discs: number } | null;
  /** Grid columns for the section's fields. */
  gridClassName?: string;
  className?: string;
}

export function TagFieldsGrid({
  entityType,
  title,
  fields,
  values,
  onValueChange,
  explicit,
  onExplicitChange,
  readOnly,
  albumStats,
  gridClassName = 'grid-cols-1 sm:grid-cols-2',
  className,
}: TagFieldsGridProps) {
  return (
    <EditorSection title={title} className={className}>
      <div className={cn('grid gap-4', gridClassName)}>
        {fields.map(({ key, label, type, autocomplete, multi, wide }) => (
          <Field
            key={key}
            label={label}
            htmlFor={`edit-${key}`}
            className={wide ? 'sm:col-span-2' : undefined}
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
              <SortablePillInput
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
    </EditorSection>
  );
}
