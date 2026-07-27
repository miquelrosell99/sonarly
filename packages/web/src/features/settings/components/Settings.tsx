import { Link, useLocation } from 'wouter';

const sections = [
  { href: '/settings/profile', label: 'Profile' },
  { href: '/settings/appearance', label: 'Appearance' },
];

function isActive(location: string, href: string): boolean {
  return location === href || location.startsWith(`${href}/`);
}

interface SettingsProps {
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export function Settings({ children, actions }: SettingsProps) {
  const [location] = useLocation();
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Settings</h2>
        {actions}
      </div>
      <nav className="mb-6 flex flex-wrap gap-2 border-b border-rule pb-2">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className={`rounded px-3 py-1 text-sm ${isActive(location, section.href) ? 'bg-fg-primary text-bg-primary' : 'text-fg-primary hover:bg-surface-hover'}`}
          >
            {section.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
