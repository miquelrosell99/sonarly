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
      className="flex items-center gap-4 rounded-card border border-outline bg-surface p-4 text-left transition-colors hover:bg-surface-container-high"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-item bg-surface-container-high text-primary">
        <Icon name={icon} size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-2xl font-semibold text-on-surface">{count.toLocaleString()}</p>
        <p className="text-xs text-on-surface-variant">{label}</p>
      </div>
      {status && (
        <span className="shrink-0 rounded-full bg-surface-container-high px-2 py-0.5 text-xs text-on-surface-variant">
          {status}
        </span>
      )}
    </button>
  );
}
