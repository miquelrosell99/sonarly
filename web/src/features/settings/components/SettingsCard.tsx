import type { ReactNode } from 'react';
import { Icon } from '../../../components/ui/Icon.js';

interface SettingsCardProps {
  /** MDI icon name rendered as a small muted marker next to the label. */
  icon?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Optional trailing control in the card header (rarely needed). */
  actions?: ReactNode;
  children: ReactNode;
}

/** Grouped settings section: card body with a muted icon + label header. */
export function SettingsCard({ icon, title, description, actions, children }: SettingsCardProps) {
  return (
    <section className="rounded-card border border-outline bg-surface p-5 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {icon && (
              <Icon name={icon} size={18} className="shrink-0 text-on-surface-variant" aria-hidden />
            )}
            <h3 className="text-sm font-semibold uppercase tracking-wider text-on-surface-variant">{title}</h3>
          </div>
          {description && <p className="mt-1 text-sm text-on-surface-variant">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
