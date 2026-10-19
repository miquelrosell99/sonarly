import { cn } from '../../../../lib/cn.js';
import { Icon } from '../../../../components/ui/Icon.js';

export function TabButton({
  active,
  onClick,
  label,
  icon,
  id,
  ariaControls,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: string;
  id: string;
  ariaControls: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      onClick={onClick}
      aria-selected={active}
      aria-controls={ariaControls}
      tabIndex={active ? 0 : -1}
      className={cn(
        'inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        active
          ? 'bg-primary text-on-primary'
          : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
      )}
    >
      <Icon name={icon} size={16} />
      {label}
    </button>
  );
}
