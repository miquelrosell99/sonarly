import { Link, useLocation } from 'wouter';

const nav = [
  { href: '/', label: 'Library' },
  { href: '/songs', label: 'Songs' },
  { href: '/playlists', label: 'Playlists' },
  { href: '/ingest', label: 'Ingest' },
  { href: '/organize', label: 'Organize' },
  { href: '/users', label: 'Users' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return (
    <div className="flex min-h-screen">
      <aside className="w-48 border-r border-gray-200 bg-gray-50 p-4">
        <h1 className="mb-6 text-xl font-bold tracking-tight">Sonarly</h1>
        <nav className="space-y-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded px-2 py-1 text-sm ${location === item.href ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-200'}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
