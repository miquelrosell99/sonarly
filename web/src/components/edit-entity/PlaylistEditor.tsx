import type { SmartPlaylistRules } from '../../types';
import { Input } from '../ui/Input.js';
import { Field } from './Field.js';
import { SmartPlaylistBlockEditor } from '../../features/playlists/index.js';

interface PlaylistEditorProps {
  readOnly?: boolean;
  isSmart: boolean;
  values: Record<string, string | string[]>;
  onValueChange: (key: string, value: string | string[]) => void;
  rules: SmartPlaylistRules | undefined;
  onRulesChange: (rules: SmartPlaylistRules | undefined) => void;
}

export function PlaylistEditor({
  readOnly,
  isSmart,
  values,
  onValueChange,
  rules,
  onRulesChange,
}: PlaylistEditorProps) {
  return (
    <div className="space-y-4">
      <Field label="Name" htmlFor="edit-name">
        <Input
          id="edit-name"
          value={String(values.name ?? '')}
          onChange={(e) => onValueChange('name', e.target.value)}
          placeholder="Name"
          disabled={readOnly}
        />
      </Field>
      {isSmart && <SmartPlaylistBlockEditor initialRules={rules} onChange={onRulesChange} />}
    </div>
  );
}
