import { Icon } from '../../../components/ui/Icon.js';

interface StatCardProps {
  icon: string;
  label: string;
  value: number;
}

export function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <div className="rounded-xl border border-rule bg-surface p-3">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-surface-hover text-accent">
        <Icon name={icon} size={18} />
      </div>
      <p className="font-mono text-2xl font-bold text-fg-primary">{value.toLocaleString()}</p>
      <p className="text-xs text-fg-secondary">{label}</p>
    </div>
  );
}
