import { useState } from 'react';
import { cn } from '../lib/cn.js';
import { Icon } from './ui/Icon.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';
import { usePreferences, useUpdatePreferences } from '../hooks/usePreferences.js';

const SPONSOR_URL = 'https://github.com/sponsors/miquelrosell99';

// Same key name as the server preferences document; the guest fallback
// (pre-login / share-token visitors, or the window before the preferences
// query resolves) mirrors it in localStorage.
const SUPPORT_HIDDEN_KEY = 'supportHidden';

// Validated read in the themeStore idiom: only the exact 'true' spelling
// counts — corrupt or stale values fall back to "shown".
function readLocalSupportHidden(): boolean {
  try {
    return window.localStorage.getItem(SUPPORT_HIDDEN_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeLocalSupportHidden(hidden: boolean) {
  try {
    window.localStorage.setItem(SUPPORT_HIDDEN_KEY, String(hidden));
  } catch {
    // storage unavailable (private mode etc.): the dismissal just won't persist
  }
}

export function SponsorButton() {
  const [open, setOpen] = useState(false);
  const { data: preferences } = usePreferences();
  const updatePreferences = useUpdatePreferences();

  // Owner of the dismissal state: the server preference once the preferences
  // document has loaded (logged in), otherwise the guest localStorage snapshot.
  const hidden = preferences
    ? Boolean(preferences.supportHidden)
    : readLocalSupportHidden();

  if (hidden) return null;

  const handleDontShowAgain = () => {
    if (preferences) {
      updatePreferences.mutate({ supportHidden: true });
    } else {
      writeLocalSupportHidden(true);
    }
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
          'hover:bg-surface-hover',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
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
            <a
              href={SPONSOR_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn whitespace-nowrap"
            >
              Open sponsors
            </a>
            <div className="flex items-center gap-2">
              <Button variant="ghost" className="whitespace-nowrap" onClick={handleDontShowAgain}>
                Don&apos;t show again
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
