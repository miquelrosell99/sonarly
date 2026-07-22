import { useState, useRef, useEffect } from 'react';
import type { User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';

interface ProfileFormProps {
  user: User;
  onUserChange: (user: User) => void;
}

function AvatarPreview({ user, className }: { user: User; className?: string }) {
  const initials = user.name && user.surname
    ? `${user.name[0]}${user.surname[0]}`.toUpperCase()
    : user.name
      ? user.name[0].toUpperCase()
      : user.username[0].toUpperCase();

  if (user.avatarUrl) {
    return <img src={user.avatarUrl} alt="" className={`rounded-full object-cover ${className}`} />;
  }
  return (
    <div className={`flex items-center justify-center rounded-full bg-gray-200 text-sm font-semibold text-gray-600 ${className}`}>
      {initials}
    </div>
  );
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-4">
        <AvatarPreview user={user} className="h-16 w-16" />
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
          <p className="mt-1 text-xs text-gray-500">PNG, JPG, WebP or GIF up to 2 MB.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-700">
            Name
          </label>
          <Input id="name" value={form.name} onChange={(e) => updateForm({ name: e.target.value })} />
        </div>
        <div>
          <label htmlFor="surname" className="mb-1 block text-sm font-medium text-gray-700">
            Surname
          </label>
          <Input id="surname" value={form.surname} onChange={(e) => updateForm({ surname: e.target.value })} />
        </div>
      </div>

      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
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
      {success && <p className="text-sm text-gray-700">Profile saved.</p>}

      <Button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save profile'}
      </Button>
    </form>
  );
}
