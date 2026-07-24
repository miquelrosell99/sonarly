import { useEffect, useRef } from 'react';
import type { User } from '@sonarly/shared';
import { ProfileForm } from './ProfileForm.js';

interface ProfileModalProps {
  user: User;
  onUserChange: (user: User) => void;
  onClose: () => void;
  onExpand: () => void;
}

export function ProfileModal({ user, onUserChange, onClose, onExpand }: ProfileModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-modal-title"
    >
      <div
        ref={panelRef}
        className="w-full max-w-md rounded-xl border border-rule bg-surface p-6 shadow-lg"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="profile-modal-title" className="text-lg font-semibold">
            Settings
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onExpand}
              className="text-sm text-muted underline hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Expand
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1 text-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              ×
            </button>
          </div>
        </div>
        <ProfileForm user={user} onUserChange={onUserChange} />
      </div>
    </div>
  );
}
