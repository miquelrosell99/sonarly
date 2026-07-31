import { useState } from 'react';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';
import { usePreferences, useUpdatePreferences } from '../hooks/usePreferences.js';

const SPONSOR_URL = 'https://github.com/sponsors/miquelrosell99';

export function SponsorButton() {
  const [open, setOpen] = useState(false);
  const { data: preferences } = usePreferences();
  const updatePreferences = useUpdatePreferences();

  if (preferences?.hideSponsorButton) return null;

  const handleOpen = () => {
    window.open(SPONSOR_URL, '_blank', 'noopener,noreferrer');
  };

  const handleHide = () => {
    updatePreferences.mutate({ hideSponsorButton: true });
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Support Sonarly"
        aria-label="Support Sonarly"
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-full text-accent transition',
          'hover:bg-surface-hover hover:text-accent',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        )}
      >
        <Icon name="mdi-heart" size={20} />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Support Sonarly"
        className="max-w-md"
        footer={
          <div className="flex items-center justify-between gap-3">
            <Button variant="primary" className="whitespace-nowrap" onClick={handleOpen}>
              Open sponsors
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" className="whitespace-nowrap" onClick={handleHide}>
                Don&apos;t show
              </Button>
              <Button variant="ghost" className="whitespace-nowrap" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        }
      >
        <p className="text-sm text-fg-secondary">
          If Sonarly is useful to you, consider sponsoring the project on GitHub.
          Your support helps keep development going.
        </p>
      </Modal>
    </>
  );
}
