import { useState } from 'react';
import { api } from '../api.js';
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';

export function Setup({ onSetup }: { onSetup: (user: { username: string; isAdmin: boolean }) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    try {
      const { user } = await api<{ user: { username: string; isAdmin: boolean } }>('/setup', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      onSetup(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Welcome to Sonarly</h1>
        <p className="text-sm text-gray-600">
          Create the admin account to get started.
        </p>
        {error && (
          <div
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600"
            role="alert"
          >
            {error}
          </div>
        )}
        <div>
          <label htmlFor="username" className="mb-1 block text-sm font-medium text-gray-700">
            Username
          </label>
          <Input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
            Password
          </label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-gray-700">
            Confirm password
          </label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-full">
          Create account
        </Button>
      </form>
    </div>
  );
}
