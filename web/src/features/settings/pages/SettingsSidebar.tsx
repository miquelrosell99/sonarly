import type { UserPreferences } from '../../../types';
import { useSettingsDraft, useSettingsSaveBar } from '../hooks/useSettingsDraft.js';
import { Settings } from '../components/Settings.js';
import { SettingsCard } from '../components/SettingsCard.js';
import { Icon } from '../../../components/ui/Icon.js';
import { Checkbox } from '../../../components/ui/Checkbox.js';
import { DEFAULT_SIDEBAR_ITEMS, SIDEBAR_LABELS } from '../../../lib/sidebar.js';
import { cn } from '../../../lib/cn.js';

type SidebarItem = NonNullable<UserPreferences['sidebarConfig']>['items'][number];

function itemLabel(item: SidebarItem): string {
  if (item.type === 'playlists') return 'Playlists';
  return SIDEBAR_LABELS[item.id] ?? item.id;
}

export function SettingsSidebar() {
  return (
    <Settings>
      <SidebarSettings />
    </Settings>
  );
}

function SidebarSettings() {
  const { values, update } = useSettingsDraft();
  useSettingsSaveBar();

  const items = values.sidebarConfig?.items ?? DEFAULT_SIDEBAR_ITEMS;

  const persist = (next: SidebarItem[]) => {
    update({ sidebarConfig: { items: next } });
  };

  const toggleVisible = (index: number) => {
    persist(items.map((item, i) => (i === index ? { ...item, visible: !item.visible } : item)));
  };

  const move = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= items.length) return;
    const next = [...items];
    [next[index], next[newIndex]] = [next[newIndex], next[index]];
    persist(next);
  };

  const toggleCollapsed = (index: number) => {
    persist(
      items.map((item, i) =>
        i === index && item.type === 'playlists' ? { ...item, collapsed: !item.collapsed } : item,
      ),
    );
  };

  return (
    <div className="w-full">
      <SettingsCard
        icon="mdi-menu"
        title="Sidebar layout"
        description="Choose which sections appear in the sidebar and use the arrow buttons to reorder them."
      >
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li
              key={item.id}
              className={cn(
                'flex items-center justify-between rounded-lg border p-3 transition',
                item.visible ? 'border-rule bg-bg-primary' : 'border-rule bg-surface opacity-60',
              )}
            >
              <Checkbox
                id={`sidebar-item-${item.id}`}
                checked={item.visible}
                onChange={() => toggleVisible(index)}
                label={itemLabel(item)}
              />

              <div className="flex items-center gap-1">
                {item.type === 'playlists' && item.visible && (
                  <button
                    onClick={() => toggleCollapsed(index)}
                    className="rounded-item p-1.5 text-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    aria-label={item.collapsed ? 'Expand playlists by default' : 'Collapse playlists by default'}
                    title={item.collapsed ? 'Expand by default' : 'Collapse by default'}
                  >
                    <Icon name={item.collapsed ? 'mdi-chevron-up' : 'mdi-chevron-down'} size={18} />
                  </button>
                )}
                <button
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  className="rounded-item p-1.5 text-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30"
                  aria-label="Move up"
                >
                  <Icon name="mdi-chevron-up" size={18} />
                </button>
                <button
                  onClick={() => move(index, 1)}
                  disabled={index === items.length - 1}
                  className="rounded-item p-1.5 text-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30"
                  aria-label="Move down"
                >
                  <Icon name="mdi-chevron-down" size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </SettingsCard>
    </div>
  );
}
