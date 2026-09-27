import { SaveBar, SaveBarProvider, useSaveBarHost } from '../../../components/ui/SaveBar.js';
import { TabNav } from './TabNav.js';

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
 * then the section tabs. Pages render inside <Settings> and register their
 * save controller via useSaveBar()/useSettingsSaveBar().
 */
export function Settings({ children }: SettingsProps) {
  return (
    <SaveBarProvider>
      <SettingsChrome>{children}</SettingsChrome>
    </SaveBarProvider>
  );
}

function SettingsChrome({ children }: SettingsProps) {
  const controller = useSaveBarHost();
  return (
    <div className="w-full">
      <div className="mb-4 flex min-h-9 items-center justify-between gap-4">
        <h2 className="font-display text-lg font-semibold">Settings</h2>
        {controller && <SaveBar controller={controller} />}
      </div>
      <TabNav items={sections} className="mb-6 border-b border-rule pb-2" />
      {children}
    </div>
  );
}
