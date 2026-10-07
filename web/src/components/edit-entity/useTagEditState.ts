import { useCallback, useState } from 'react';
import type { EntityType } from '../EditEntityModal.js';
import { getCommonBoolean, getCommonValue, initialTagValuesForEntities } from './tagValues.js';
import type { TagField } from './fields.js';

function initialValues(
  activeEntities: Record<string, unknown>[],
  entityType: EntityType,
  fields: TagField[],
  isMulti: boolean,
): Record<string, string | string[]> {
  if (entityType === 'playlist') {
    return {
      name: String(getCommonValue(activeEntities, 'name') ?? ''),
    };
  }
  if (entityType === 'artist') {
    return { name: String(getCommonValue(activeEntities, 'name') ?? '') };
  }
  return initialTagValuesForEntities(activeEntities, fields, isMulti);
}

/**
 * Multi-edit reducer for the entity tag-edit modal: the form values, the
 * shared explicit flag, and the touched-fields set that gates which keys a
 * multi-entity save may patch. Extracted from EditEntityModal.tsx
 * (audit F22, plan P10b).
 */
export function useTagEditState(
  activeEntities: Record<string, unknown>[],
  entityType: EntityType,
  fields: TagField[],
  isMulti: boolean,
) {
  const [values, setValues] = useState<Record<string, string | string[]>>(() =>
    initialValues(activeEntities, entityType, fields, isMulti),
  );
  const [explicit, setExplicit] = useState(() => getCommonBoolean(activeEntities, 'explicit'));
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());

  const updateValue = useCallback(
    (key: string, value: string | string[]) => {
      setValues((prev) => ({ ...prev, [key]: value }));
      if (isMulti) {
        setTouchedFields((prev) => new Set(prev).add(key));
      }
    },
    [isMulti],
  );

  // Fills a field only while it is still empty (the lyrics editor seeds from
  // the lyrics endpoint after the modal resets on open). Unlike updateValue
  // it never marks the field touched — a seeded value is not a user edit and
  // must not sneak into a multi-entity save.
  const seedValue = useCallback((key: string, value: string | string[]) => {
    setValues((prev) => {
      const current = prev[key];
      if (current !== undefined && current !== '') return prev;
      return { ...prev, [key]: value };
    });
  }, []);

  const updateExplicit = useCallback(
    (checked: boolean) => {
      setExplicit(checked);
      if (isMulti) {
        setTouchedFields((prev) => new Set(prev).add('explicit'));
      }
    },
    [isMulti],
  );

  const resetTagEdit = useCallback(() => {
    setValues(() => initialValues(activeEntities, entityType, fields, isMulti));
    setExplicit(getCommonBoolean(activeEntities, 'explicit'));
    setTouchedFields(new Set());
  }, [activeEntities, entityType, fields, isMulti]);

  return { values, explicit, touchedFields, updateValue, updateExplicit, seedValue, resetTagEdit };
}
