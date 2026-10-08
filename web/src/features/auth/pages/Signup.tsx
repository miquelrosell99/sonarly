import { useState } from 'react';
import { Link } from 'wouter';
import type { User } from '../../../types';
import { api } from '../../../lib/api.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { BrandMark } from '../../../components/BrandMark.js';

const MIN_PASSWORD = 8;

export function Signup({ onSignup }: { onSignup: (user: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const { user } = await api<{ user: User }>('/signup', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      onSignup(user);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Signup failed';
      setError(message === 'Not found' ? 'Signups are disabled on this server.' : message);
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
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="confirm" className="mb-1 block text-sm font-medium text-fg-primary">
            Confirm password
          </label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
        <p className="text-center text-sm text-fg-secondary">
          Already have an account?{' '}
          <Link href="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
