import { Link, useLocation } from 'wouter';
import type { User } from '@sonarly/shared';

const tabs = [
  { href: '/admin/status', label: 'Status' },
  { href: '/admin/ingest', label: 'Ingest' },
  { href: '/admin/users', label: 'Users' },
];

function isActive(location: string, href: string): boolean {
  return location === href || location.startsWith(`${href}/`);
}

interface AdminShellProps {
  user: User;
  children: React.ReactNode;
}

export function AdminShell({ user, children }: AdminShellProps) {
  const [location] = useLocation();

  if (!user.isAdmin) {
    return (
      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold">Admin panel</h2>
        <p className="mt-2 text-sm text-muted">You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <h2 className="text-lg font-semibold">Admin panel</h2>
      <nav className="mb-6 mt-4 flex gap-2 border-b border-rule pb-2">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded px-3 py-1 text-sm ${isActive(location, tab.href) ? 'bg-fg-primary text-bg-primary' : 'text-fg-primary hover:bg-surface-hover'}`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
