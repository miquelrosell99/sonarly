export type ThemeMode = 'light' | 'dark' | 'oled' | 'auto';
export type AccentColor =
  | 'auto'
  | 'monochrome'
  | 'brown'
  | 'green'
  | 'orange'
  | 'teal'
  | 'purple'
  | 'yellow'
  | 'cyan'
  | 'blue';

export type AutoDjMode = 'similar' | 'random' | 'smart';

export interface SidebarLinkItem {
  id: string;
  type: 'link';
  visible: boolean;
}

export interface SidebarPlaylistsItem {
  id: 'playlists';
  type: 'playlists';
  visible: boolean;
  collapsed: boolean;
}

export type SidebarItem = SidebarLinkItem | SidebarPlaylistsItem;

export interface UserPreferences {
  sidebar?: {
    items?: string[];
    collapsedSections?: string[];
  };
  theme?: {
    mode?: 'light' | 'dark' | 'oled' | 'auto';
    accent?: string;
  };
  themeMode?: ThemeMode;
  accentColor?: AccentColor;
  sidebarConfig?: {
    items: SidebarItem[];
  };
  playlistsCollapsed?: boolean;
  viewOptions?: Record<string, unknown>;
  autoDjEnabled?: boolean;
  autoDjMode?: AutoDjMode;
  autoDjTopUpThreshold?: number;
  autoDjBatchSize?: number;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  autoDjEnabled: false,
  autoDjMode: 'smart',
  autoDjTopUpThreshold: 5,
  autoDjBatchSize: 10,
};
