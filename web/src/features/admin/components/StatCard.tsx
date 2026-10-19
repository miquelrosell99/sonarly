import { Icon } from '../../../components/ui/Icon.js';

interface StatCardProps {
  icon: string;
  label: string;
  value: number;
}

export function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <div className="rounded-card border border-outline bg-surface p-3">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-item bg-surface-container-high text-primary">
        <Icon name={icon} size={18} />
      </div>
      <p className="font-mono text-2xl font-semibold text-on-surface">{value.toLocaleString()}</p>
      <p className="text-xs text-on-surface-variant">{label}</p>
    </div>
  );
}
