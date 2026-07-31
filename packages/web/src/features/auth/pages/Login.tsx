import { useState } from 'react';
import type { User } from '@sonarly/shared';
import { api } from '../../../api.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const { user } = await api<{ user: User }>('/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-fg-primary">Sonarly</h1>
        {error && (
          <div
            className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500"
            role="alert"
          >
            The username or password is incorrect. Please try again.
          </div>
        )}
        <div>
          <label htmlFor="username" className="mb-1 block text-sm font-medium text-fg-primary">
            Username
          </label>
          <Input
            id="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-fg-primary">
            Password
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-full">
          Sign in
        </Button>
      </form>
    </div>
  );
}
