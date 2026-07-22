import { useState } from 'react';
import { api } from '../api.js';
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';

export function Users() {
  const [form, setForm] = useState({ username: '', password: '', isAdmin: false });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const updateForm = (patch: Partial<typeof form>) => {
    setSuccess(false);
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const create = async () => {
    if (!form.username.trim() || !form.password) return;
    setCreating(true);
    setError(null);
    setSuccess(false);
    try {
      await api('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: form.username.trim(),
          password: form.password,
          isAdmin: form.isAdmin,
        }),
      });
      setForm({ username: '', password: '', isAdmin: false });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <h3 className="mb-4 text-base font-medium">Users</h3>
      <div className="space-y-3 border border-gray-200 p-4">
        <Input
          placeholder="Username"
          value={form.username}
          onChange={(e) => updateForm({ username: e.target.value })}
        />
        <Input
          placeholder="Password"
          type="password"
          value={form.password}
          onChange={(e) => updateForm({ password: e.target.value })}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isAdmin}
            onChange={(e) => updateForm({ isAdmin: e.target.checked })}
            className="rounded border-gray-300"
          />
          Admin
        </label>
        <Button onClick={create} disabled={creating || !form.username.trim() || !form.password}>
          Create User
        </Button>
      </div>
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      {success && <p className="mt-4 text-sm text-gray-700">User created.</p>}
    </div>
  );
}
