import { Icon } from '../../../components/ui/Icon.js';

interface StatusPillProps {
  status: string;
}

const config: Record<
  string,
  { label: string; icon: string; className: string }
> = {
  // Worker job statuses
  pending: { label: 'Pending', icon: 'mdi-clock-outline', className: 'bg-warning/10 text-warning' },
  running: { label: 'Running', icon: 'mdi-refresh', className: 'bg-info/10 text-info' },
  completed: { label: 'Completed', icon: 'mdi-check-circle-outline', className: 'bg-success/10 text-success' },
  failed: { label: 'Failed', icon: 'mdi-alert-circle-outline', className: 'bg-danger/10 text-danger' },
  // Ingest job statuses
  imported: { label: 'Imported', icon: 'mdi-check-circle-outline', className: 'bg-success/10 text-success' },
  skipped: { label: 'Skipped', icon: 'mdi-skip-next', className: 'bg-surface text-muted' },
  needs_review: { label: 'Needs review', icon: 'mdi-alert-circle-outline', className: 'bg-warning/10 text-warning' },
};

export function StatusPill({ status }: StatusPillProps) {
  const resolved = config[status] ?? {
    label: status,
    icon: 'mdi-help-circle-outline',
    className: 'bg-surface text-muted',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${resolved.className}`}
    >
      <Icon name={resolved.icon} size={14} />
      <span>{resolved.label}</span>
    </span>
  );
}
