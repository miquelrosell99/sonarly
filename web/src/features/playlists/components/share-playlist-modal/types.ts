export interface LookupUser {
  id: string;
  username: string;
  name: string | null;
}

export type ShareTab = 'members' | 'links';

export const SHARE_TABS: { key: ShareTab; label: string; icon: string }[] = [
  { key: 'members', label: 'Members', icon: 'mdi-account-multiple-outline' },
  { key: 'links', label: 'Share links', icon: 'mdi-link-variant' },
];
