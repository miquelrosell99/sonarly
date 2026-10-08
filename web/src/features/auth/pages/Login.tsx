import { useState } from 'react';
import { Link } from 'wouter';
import type { User } from '../../../types';
import { api } from '../../../lib/api.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { BrandMark } from '../../../components/BrandMark.js';

export function Login({ onLogin, signupEnabled = false }: { onLogin: (user: User) => void; signupEnabled?: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const { user } = await api<{ user: User }>('/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      onLogin(user);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(
        message === 'Invalid credentials'
          ? 'The username or password is incorrect. Please try again.'
          : message,
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <div className="flex flex-col items-center gap-3 pb-4 text-center">
          <BrandMark className="h-14 w-14" />
          <h1 className="font-display text-3xl font-semibold tracking-tight text-fg-primary">
            Sonarly
          </h1>
        </div>
        {error && (
          <div
            className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
            role="alert"
          >
            {error}
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
            autoFocus
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
        {/* Full-pill is a deliberate brand moment on the sign-in button —
          the app-wide .btn radius is 16px, this instance keeps the pill. */}
        <Button type="submit" className="btn-pill w-full" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
        {signupEnabled && (
          <p className="text-center text-sm text-fg-secondary">
            No account yet?{' '}
            <Link href="/signup" className="text-accent hover:underline">
              Create one
            </Link>
          </p>
        )}
      </form>
    </div>
  );
}
