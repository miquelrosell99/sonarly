import { useEffect, useState, useRef } from 'react';
import type { User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { Avatar } from '../../../components/Avatar.js';

interface ProfileFormProps {
  user: User;
  onUserChange: (user: User) => void;
}

export function ProfileForm({ user, onUserChange }: ProfileFormProps) {
  const [form, setForm] = useState({
    name: user.name ?? '',
    surname: user.surname ?? '',
    email: user.email ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setForm({
      name: user.name ?? '',
      surname: user.surname ?? '',
      email: user.email ?? '',
    });
  }, [user]);

  const updateForm = (patch: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setSuccess(false);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const payload = {
        name: form.name.trim() || undefined,
        surname: form.surname.trim() || undefined,
        email: form.email.trim() || undefined,
      };
      const { user: updated } = await api<{ user: User }>('/me', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      onUserChange(updated);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('avatar', file);
      const res = await fetch('/api/me/avatar', {
        method: 'POST',
        body,
        credentials: 'include',
      });
      if (!res.ok) {
        const text = await res.text();
        let message = text;
        try {
          const parsed = JSON.parse(text) as { error?: string };
          if (parsed.error) message = parsed.error;
        } catch {}
        throw new Error(message);
      }
      const { user: updated } = (await res.json()) as { user: User };
      onUserChange(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload avatar');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center gap-4">
        <Avatar user={user} className="h-16 w-16" variant="surface" />
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleFileChange}
            className="hidden"
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : 'Change avatar'}
          </Button>
          <p className="mt-1 text-xs text-muted">PNG, JPG, WebP or GIF up to 2 MB.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-fg-primary">
            Name
          </label>
          <Input id="name" value={form.name} onChange={(e) => updateForm({ name: e.target.value })} />
        </div>
        <div>
          <label htmlFor="surname" className="mb-1 block text-sm font-medium text-fg-primary">
            Surname
          </label>
          <Input id="surname" value={form.surname} onChange={(e) => updateForm({ surname: e.target.value })} />
        </div>
      </div>

      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-fg-primary">
          Email
        </label>
        <Input
          id="email"
          type="email"
          value={form.email}
          onChange={(e) => updateForm({ email: e.target.value })}
        />
      </div>

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      {success && <p className="text-sm text-fg-primary">Profile saved.</p>}

      <Button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save profile'}
      </Button>
    </form>
  );
}
