import type { User } from '@sonarly/shared';
import { Settings } from '../components/Settings.js';
import { ProfileForm } from '../../profile/index.js';

interface SettingsProfileProps {
  user: User;
  onUserChange: (user: User) => void;
}

export function SettingsProfile({ user, onUserChange }: SettingsProfileProps) {
  return (
    <Settings>
      <div className="max-w-2xl">
        <h3 className="mb-4 text-base font-medium">Profile</h3>
        <ProfileForm user={user} onUserChange={onUserChange} />
      </div>
    </Settings>
  );
}
