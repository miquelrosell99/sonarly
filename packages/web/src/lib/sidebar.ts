import type { SidebarItem, UserPreferences } from '@sonarly/shared';

export interface SidebarItemDefinition {
  id: string;
  type: 'link';
  label: string;
  default?: boolean;
}

export const SIDEBAR_ITEM_DEFINITIONS: SidebarItemDefinition[] = [
  { id: 'home', type: 'link', label: 'Home', default: true },
  { id: 'albums', type: 'link', label: 'Albums', default: true },
  { id: 'tracks', type: 'link', label: 'Tracks', default: true },
  { id: 'album-artists', type: 'link', label: 'Album Artists', default: true },
  { id: 'artists', type: 'link', label: 'Artists', default: true },
  { id: 'genres', type: 'link', label: 'Genres', default: true },
  { id: 'years', type: 'link', label: 'Years', default: true },
  { id: 'composers', type: 'link', label: 'Composers' },
  { id: 'labels', type: 'link', label: 'Labels' },
  { id: 'album-types', type: 'link', label: 'Album Types' },
];

export const DEFAULT_PLAYLISTS_ITEM: Extract<SidebarItem, { type: 'playlists' }> = {
  id: 'playlists',
  type: 'playlists',
  visible: true,
  collapsed: false,
};

export const DEFAULT_SIDEBAR_ITEMS: SidebarItem[] = SIDEBAR_ITEM_DEFINITIONS
  .filter((def) => def.default)
  .map((def): SidebarItem => ({ id: def.id, type: 'link', visible: true }));

export const SIDEBAR_LABELS: Record<string, string> = Object.fromEntries(
  SIDEBAR_ITEM_DEFINITIONS.map((def) => [def.id, def.label]),
);

export function mergeSidebarItems(config: UserPreferences['sidebarConfig']): SidebarItem[] {
  if (!config) return DEFAULT_SIDEBAR_ITEMS;
  return config.items;
}
