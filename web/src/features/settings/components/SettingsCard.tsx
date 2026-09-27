import type { ReactNode } from 'react';
import { Icon } from '../../../components/ui/Icon.js';

interface SettingsCardProps {
  /** MDI icon name rendered in the accent-tinted header tile. */
  icon?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Optional trailing control in the card header (rarely needed). */
  actions?: ReactNode;
  children: ReactNode;
}

/** Grouped settings section: card body with an icon + title + description header. */
export function SettingsCard({ icon, title, description, actions, children }: SettingsCardProps) {
  return (
    <section className="rounded-xl border border-rule bg-surface p-5 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {icon && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-accent">
              <Icon name={icon} size={20} />
            </div>
          )}
          <div>
            <h3 className="font-display text-base font-semibold text-fg-primary">{title}</h3>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
