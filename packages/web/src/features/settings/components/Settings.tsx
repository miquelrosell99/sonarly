import { TabNav } from './TabNav.js';

const sections = [
  { key: '/settings/profile', label: 'Profile' },
  { key: '/settings/appearance', label: 'Appearance' },
  { key: '/settings/playback', label: 'Playback' },
  { key: '/settings/sidebar', label: 'Sidebar' },
];

interface SettingsProps {
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export function Settings({ children, actions }: SettingsProps) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Settings</h2>
        {actions}
      </div>
      <TabNav items={sections} className="mb-6 border-b border-rule pb-2" />
      {children}
    </div>
  );
}
