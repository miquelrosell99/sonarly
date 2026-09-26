import type { User } from '../../../types';
import { Modal } from '../../../components/ui/Modal.js';
import { ProfileForm } from './ProfileForm.js';

interface ProfileModalProps {
  user: User;
  onUserChange: (user: User) => void;
  onClose: () => void;
}

export function ProfileModal({ user, onUserChange, onClose }: ProfileModalProps) {
  return (
    <Modal open onClose={onClose} title="Profile" className="max-w-md">
      <ProfileForm user={user} onUserChange={onUserChange} />
    </Modal>
  );
}
