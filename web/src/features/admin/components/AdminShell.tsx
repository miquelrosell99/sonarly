import type { User } from '../../../types';
import { SaveBar, SaveBarProvider, useSaveBarHost } from '../../../components/ui/SaveBar.js';
import { TabNav } from '../../settings/index.js';

// Overview → people → content sources → content pipeline → metadata →
// maintenance.
const tabs = [
  { key: '/admin/status', label: 'Status' },
  { key: '/admin/users', label: 'Users' },
  { key: '/admin/libraries', label: 'Libraries' },
  { key: '/admin/media', label: 'Media' },
  { key: '/admin/genres', label: 'Genres' },
  { key: '/admin/system-tasks', label: 'System Tasks' },
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
    <SaveBarProvider>
      <AdminChrome>{children}</AdminChrome>
    </SaveBarProvider>
  );
}

function AdminChrome({ children }: { children: React.ReactNode }) {
  const controller = useSaveBarHost();
  return (
    <div className="w-full">
      <div className="mb-4 flex min-h-9 items-center justify-between gap-4">
        <h2 className="font-display text-lg font-semibold">Admin panel</h2>
        {controller && <SaveBar controller={controller} />}
      </div>
      <TabNav items={tabs} className="mb-6 border-b border-rule" />
      {children}
    </div>
  );
}
