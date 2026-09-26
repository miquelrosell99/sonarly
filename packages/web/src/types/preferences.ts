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

export type AutoDjExcludeWindow = '24h' | '7d' | '30d';

export const AUTO_DJ_EXCLUDE_WINDOWS: AutoDjExcludeWindow[] = ['24h', '7d', '30d'];

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
  autoDjExcludeWindow?: AutoDjExcludeWindow;
  autoDjPreferFavorites?: boolean;
  /** 0 = familiar (known, well-played tracks), 100 = adventurous (deep cuts). */
  autoDjDiscovery?: number;
  hideSponsorButton?: boolean;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  autoDjEnabled: false,
  autoDjMode: 'smart',
  autoDjTopUpThreshold: 5,
  autoDjBatchSize: 10,
  autoDjExcludeWindow: '24h',
  autoDjPreferFavorites: false,
  autoDjDiscovery: 50,
};

export const MAX_EXCLUDE_IDS = 500;
