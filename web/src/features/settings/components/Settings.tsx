import { Link, useLocation } from 'wouter';
import { SaveBar, SaveBarProvider, useSaveBarHost } from '../../../components/ui/SaveBar.js';
import { TabNav } from './TabNav.js';
import { cn } from '../../../lib/cn.js';

// Order mirrors the page chrome: account → look → library → playback →
// navigation.
const sections = [
  { key: '/settings/profile', label: 'Profile' },
  { key: '/settings/appearance', label: 'Appearance' },
  { key: '/settings/library', label: 'Library' },
  { key: '/settings/playback', label: 'Playback' },
  { key: '/settings/sidebar', label: 'Sidebar' },
];

interface SettingsProps {
  children: React.ReactNode;
}

/**
 * Settings chrome: title row with the unsaved-changes save bar on the right,
 * then navigation — a vertical section rail on desktop (the System Settings /
 * Spotify pattern: the rail fills wide viewports and reads deliberate at any
 * width) collapsing to the horizontal accent-underline tabs on mobile.
 * Pages render inside <Settings> and register their save controller via
 * useSaveBar()/useSettingsSaveBar().
 */
export function Settings({ children }: SettingsProps) {
  return (
    <SaveBarProvider>
      <SettingsChrome>{children}</SettingsChrome>
    </SaveBarProvider>
  );
}

function isSectionActive(location: string, key: string): boolean {
  return location === key || location.startsWith(`${key}/`);
}

function SettingsChrome({ children }: SettingsProps) {
  const controller = useSaveBarHost();
  const [location] = useLocation();
  return (
    <div className="w-full">
      <div className="mb-4 flex min-h-9 items-center justify-between gap-4">
        <h2 className="font-display text-lg font-semibold">Settings</h2>
        {controller && <SaveBar controller={controller} />}
      </div>
      <div className="flex flex-col gap-8 md:flex-row">
        <nav aria-label="Settings sections" className="hidden w-48 shrink-0 flex-col gap-1 md:flex">
          {sections.map((section) => {
            const active = isSectionActive(location, section.key);
            return (
              <Link
                key={section.key}
                href={section.key}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  // Inset accent bar on the active item — the sidebar's
                  // language — with no layout shift.
                  'rounded-md px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  active
                    ? 'bg-surface-hover font-medium text-fg-primary shadow-[inset_2px_0_0_0_hsl(var(--accent))]'
                    : 'text-muted hover:bg-surface-hover hover:text-fg-primary',
                )}
              >
                {section.label}
              </Link>
            );
          })}
        </nav>
        <TabNav
          items={sections}
          className="border-b border-rule md:hidden"
        />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
