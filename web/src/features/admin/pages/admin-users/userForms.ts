import type { User } from '../../../../types';

export const TRANSCODE_FORMATS: Array<NonNullable<User['transcodeFormat']>> = ['mp3', 'aac', 'opus'];
export type UserRole = 'user' | 'administrator';

export interface CreateForm {
  username: string;
  password: string;
  name: string;
  surname: string;
  email: string;
  role: UserRole;
  maxBitrateKbps: string;
  transcodeFormat: User['transcodeFormat'] | '';
}

export interface EditForm {
  role: UserRole;
  name: string;
  surname: string;
  email: string;
  password: string;
  maxBitrateKbps: string;
  transcodeFormat: User['transcodeFormat'] | '';
  hideExplicit: boolean;
  blurExplicitTitles: boolean;
  blurExplicitCovers: boolean;
}

export function parseBitrate(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = parseInt(trimmed, 10);
  if (Number.isNaN(n)) return undefined;
  return n;
}

export function roleFromUser(isAdmin: boolean): UserRole {
  return isAdmin ? 'administrator' : 'user';
}

export const emptyCreateForm: CreateForm = {
  username: '',
  password: '',
  name: '',
  surname: '',
  email: '',
  role: 'user',
  maxBitrateKbps: '',
  transcodeFormat: '',
};

export const emptyEditForm: EditForm = {
  role: 'user',
  name: '',
  surname: '',
  email: '',
  password: '',
  maxBitrateKbps: '',
  transcodeFormat: '',
  hideExplicit: false,
  blurExplicitTitles: false,
  blurExplicitCovers: false,
};

export function formatLabel(f?: User['transcodeFormat']) {
  return f?.toUpperCase() ?? 'Original';
}

export function formatRole(isAdmin: boolean) {
  return isAdmin ? 'Administrator' : 'User';
}
