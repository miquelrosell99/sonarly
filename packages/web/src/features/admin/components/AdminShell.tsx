import type { User } from '@sonarly/shared';
import { TabNav } from '../../settings/index.js';

const tabs = [
  { key: '/admin/status', label: 'Status' },
  { key: '/admin/libraries', label: 'Libraries' },
  { key: '/admin/media', label: 'Media' },
  { key: '/admin/users', label: 'Users' },
  { key: '/admin/system-tasks', label: 'System Tasks' },
  { key: '/admin/genres', label: 'Genres' },
];

interface AdminShellProps {
  user: User;
  children: React.ReactNode;
}

export function AdminShell({ user, children }: AdminShellProps) {
  if (!user.isAdmin) {
    return (
      <div className="w-full">
        <h2 className="font-display text-lg font-semibold">Admin panel</h2>
        <p className="mt-2 text-sm text-muted">You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <h2 className="font-display text-lg font-semibold">Admin panel</h2>
      <TabNav items={tabs} className="mb-6 mt-4 border-b border-rule pb-2" />
      {children}
    </div>
  );
}
