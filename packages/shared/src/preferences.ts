export type ThemeMode = 'light' | 'dark' | 'oled' | 'auto';
export type AccentColor = 'monochrome' | 'brown' | 'green' | 'orange' | 'teal' | 'purple' | 'yellow';

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
  hideExplicit?: boolean;
  blurExplicitTitles?: boolean;
  blurExplicitCovers?: boolean;
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
  viewOptions?: Record<string, unknown>;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  hideExplicit: false,
  blurExplicitTitles: false,
  blurExplicitCovers: false,
};
