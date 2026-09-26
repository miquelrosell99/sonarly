export interface User {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  name?: string;
  surname?: string;
  email?: string;
  avatarUrl?: string;
  maxBitrateKbps?: number;
  transcodeFormat?: 'mp3' | 'aac' | 'opus';
  hideExplicit?: boolean;
  blurExplicitTitles?: boolean;
  blurExplicitCovers?: boolean;
}

export interface CreateUserInput {
  username: string;
  password: string;
  isAdmin?: boolean;
  name?: string | null;
  surname?: string | null;
  email?: string | null;
  maxBitrateKbps?: number;
  transcodeFormat?: 'mp3' | 'aac' | 'opus';
}

export interface UpdateProfileInput {
  name?: string;
  surname?: string;
  email?: string;
}

export interface UpdateUserContentFiltersInput {
  hideExplicit?: boolean;
  blurExplicitTitles?: boolean;
  blurExplicitCovers?: boolean;
}
