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
  { key: '/settings/about', label: 'About' },
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
        <h1 className="font-display text-lg font-semibold">Settings</h1>
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
                  // Accent bar on the active item — the sidebar's language —
                  // a real element, with no layout shift.
                  'relative rounded-item px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  active
                    ? 'bg-surface-hover font-medium text-fg-primary'
                    : 'text-muted hover:bg-surface-hover hover:text-fg-primary',
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
                )}
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
