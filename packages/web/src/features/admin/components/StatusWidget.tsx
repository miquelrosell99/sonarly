import { Icon } from '../../../components/ui/Icon.js';

interface StatusWidgetProps {
  label: string;
  count: number;
  icon: string;
  onClick: () => void;
  status?: string;
}

export function StatusWidget({ label, count, icon, onClick, status }: StatusWidgetProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-4 rounded-xl border border-rule bg-surface p-4 text-left transition-colors hover:bg-surface-hover"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-accent">
        <Icon name={icon} size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-2xl font-bold text-fg-primary">{count.toLocaleString()}</p>
        <p className="text-xs text-fg-secondary">{label}</p>
      </div>
      {status && (
        <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-xs text-muted">
          {status}
        </span>
      )}
    </button>
  );
}
