import type { User } from '../../../types';
import { Settings } from '../components/Settings.js';
import { SettingsCard } from '../components/SettingsCard.js';
import { ProfileForm } from '../../profile/index.js';

interface SettingsProfileProps {
  user: User;
  onUserChange: (user: User) => void;
}

export function SettingsProfile({ user, onUserChange }: SettingsProfileProps) {
  return (
    <Settings>
      <div className="w-full max-w-3xl">
        <SettingsCard
          icon="mdi-account"
          title="Profile"
          description="Your name, email address and avatar."
        >
          <ProfileForm user={user} onUserChange={onUserChange} />
        </SettingsCard>
      </div>
    </Settings>
  );
}
