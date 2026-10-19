import { Button } from '../../../../components/ui/button.js';
import { Input } from '../../../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select.js';
import { Modal } from '../../../../components/ui/Modal.js';
import { TRANSCODE_FORMATS, type CreateForm, type UserRole } from './userForms.js';
import type { User } from '../../../../types';

interface CreateUserModalProps {
  open: boolean;
  form: CreateForm;
  creating: boolean;
  error: string | null;
  onClose: () => void;
  onChange: (patch: Partial<CreateForm>) => void;
  onCreate: () => void;
}

export function CreateUserModal({ open, form, creating, error, onClose, onChange, onCreate }: CreateUserModalProps) {
  const footer = (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={onClose} disabled={creating}>
        Cancel
      </Button>
      <Button onClick={onCreate} disabled={creating || !form.username.trim() || !form.password}>
        Create User
      </Button>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title="Add User" footer={footer}>
      <div className="space-y-4">
        {error && <p className="text-sm text-error" role="alert">{error}</p>}
        <div className="space-y-1">
          <label htmlFor="user-username" className="block text-sm font-medium text-on-surface-variant">Username</label>
          <Input
            id="user-username"
            placeholder="Username"
            value={form.username}
            onChange={(e) => onChange({ username: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="user-password" className="block text-sm font-medium text-on-surface-variant">Password</label>
          <Input
            id="user-password"
            placeholder="Password"
            type="password"
            value={form.password}
            onChange={(e) => onChange({ password: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="user-name" className="block text-sm font-medium text-on-surface-variant">Name</label>
            <Input
              id="user-name"
              placeholder="Name"
              value={form.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="user-surname" className="block text-sm font-medium text-on-surface-variant">Surname</label>
            <Input
              id="user-surname"
              placeholder="Surname"
              value={form.surname}
              onChange={(e) => onChange({ surname: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="user-email" className="block text-sm font-medium text-on-surface-variant">Email</label>
          <Input
            id="user-email"
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => onChange({ email: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="user-role" className="block text-sm font-medium text-on-surface-variant">Role</label>
          <Select
            value={form.role}
            onValueChange={(value) => onChange({ role: value as UserRole })}
          >
            <SelectTrigger id="user-role" className="w-full">
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
            <label htmlFor="user-format" className="block text-sm font-medium text-on-surface-variant">Transcode format</label>
            {/* Radix Select items can't carry an empty value, so "Original
               format" rides the '__original' sentinel and maps to ''. */}
            <Select
              value={form.transcodeFormat || '__original'}
              onValueChange={(value) => onChange({ transcodeFormat: (value === '__original' ? '' : value) as User['transcodeFormat'] | '' })}
            >
              <SelectTrigger id="user-format" aria-label="Transcode format" className="w-full">
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
            <label htmlFor="user-bitrate" className="block text-sm font-medium text-on-surface-variant">Max bitrate</label>
            <Input
              id="user-bitrate"
              type="number"
              min={64}
              max={320}
              step={1}
              placeholder="Max bitrate (kbps) — optional"
              value={form.maxBitrateKbps}
              onChange={(e) => onChange({ maxBitrateKbps: e.target.value })}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
