import { Link, useLocation } from 'wouter';

const sections = [
  { href: '/settings/media', label: 'Media Management' },
  { href: '/settings/users', label: 'Users' },
];

function isActive(location: string, href: string): boolean {
  return location === href || location.startsWith(`${href}/`);
}

export function Settings({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Settings</h2>
      <nav className="mb-6 flex gap-2 border-b border-gray-200 pb-2">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className={`rounded px-3 py-1 text-sm ${isActive(location, section.href) ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            {section.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
