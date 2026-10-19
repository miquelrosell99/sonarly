import { Button } from '../../../../components/ui/button.js';
import { Input } from '../../../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select.js';
import { Checkbox } from '../../../../components/ui/checkbox.js';
import { Modal } from '../../../../components/ui/Modal.js';
import type { User } from '../../../../types';
import { TRANSCODE_FORMATS, type EditForm, type UserRole } from './userForms.js';
import { UserLibrariesSection } from './UserLibrariesSection.js';

interface EditUserModalProps {
  editingUser: User | null;
  editForm: EditForm;
  saving: boolean;
  error: string | null;
  canDemoteOrDeleteAdmin: boolean;
  selfId: string;
  onClose: () => void;
  onChange: React.Dispatch<React.SetStateAction<EditForm>>;
  onSave: () => void;
}

export function EditUserModal({
  editingUser,
  editForm,
  saving,
  error,
  canDemoteOrDeleteAdmin,
  selfId,
  onClose,
  onChange,
  onSave,
}: EditUserModalProps) {
  const footer = (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={onClose} disabled={saving}>
        Cancel
      </Button>
      <Button onClick={onSave} disabled={saving}>
        Save Changes
      </Button>
    </div>
  );

  return (
    <Modal
      open={!!editingUser}
      onClose={onClose}
      title={editingUser ? `Edit ${editingUser.username}` : 'Edit User'}
      footer={footer}
    >
      <div className="space-y-4">
        {error && <p className="text-sm text-error" role="alert">{error}</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="edit-name" className="block text-sm font-medium text-on-surface-variant">Name</label>
            <Input
              id="edit-name"
              placeholder="Name"
              value={editForm.name}
              onChange={(e) => onChange((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="edit-surname" className="block text-sm font-medium text-on-surface-variant">Surname</label>
            <Input
              id="edit-surname"
              placeholder="Surname"
              value={editForm.surname}
              onChange={(e) => onChange((prev) => ({ ...prev, surname: e.target.value }))}
            />
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="edit-email" className="block text-sm font-medium text-on-surface-variant">Email</label>
          <Input
            id="edit-email"
            type="email"
            placeholder="Email"
            value={editForm.email}
            onChange={(e) => onChange((prev) => ({ ...prev, email: e.target.value }))}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="edit-password" className="block text-sm font-medium text-on-surface-variant">New password</label>
          <Input
            id="edit-password"
            type="password"
            placeholder="Leave blank to keep current"
            value={editForm.password}
            onChange={(e) => onChange((prev) => ({ ...prev, password: e.target.value }))}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="edit-role" className="block text-sm font-medium text-on-surface-variant">Role</label>
          <Select
            value={editForm.role}
            onValueChange={(value) => onChange((prev) => ({ ...prev, role: value as UserRole }))}
            disabled={editingUser?.id === selfId || (editingUser?.isAdmin === true && !canDemoteOrDeleteAdmin)}
          >
            <SelectTrigger id="edit-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="administrator">Administrator</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="edit-format" className="block text-sm font-medium text-on-surface-variant">Transcode format</label>
            {/* Radix Select items can't carry an empty value, so "Original
               format" rides the '__original' sentinel and maps to ''. */}
            <Select
              value={editForm.transcodeFormat || '__original'}
              onValueChange={(value) => onChange((prev) => ({ ...prev, transcodeFormat: (value === '__original' ? '' : value) as User['transcodeFormat'] | '' }))}
            >
              <SelectTrigger id="edit-format" aria-label="Transcode format" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__original">Original format</SelectItem>
                {TRANSCODE_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label htmlFor="edit-bitrate" className="block text-sm font-medium text-on-surface-variant">Max bitrate</label>
            <Input
              id="edit-bitrate"
              type="number"
              min={64}
              max={320}
              step={1}
              placeholder="Max bitrate (kbps) — optional"
              value={editForm.maxBitrateKbps}
              onChange={(e) => onChange((prev) => ({ ...prev, maxBitrateKbps: e.target.value }))}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Checkbox
            label="Hide explicit"
            checked={editForm.hideExplicit}
            onCheckedChange={(checked) => onChange((prev) => ({ ...prev, hideExplicit: checked }))}
          />
          <Checkbox
            label="Blur titles"
            checked={editForm.blurExplicitTitles}
            onCheckedChange={(checked) => onChange((prev) => ({ ...prev, blurExplicitTitles: checked }))}
          />
          <Checkbox
            label="Blur covers"
            checked={editForm.blurExplicitCovers}
            onCheckedChange={(checked) => onChange((prev) => ({ ...prev, blurExplicitCovers: checked }))}
          />
        </div>

        {editingUser && <UserLibrariesSection userId={editingUser.id} />}
      </div>
    </Modal>
  );
}
