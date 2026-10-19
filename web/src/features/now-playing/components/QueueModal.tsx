import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User } from '../../../types';
import { cn } from '../../../lib/cn.js';
import { Icon } from '../../../components/ui/Icon.js';
import { ControlButton } from '../../player/PlayerControls.js';
import { QueueList } from './QueueList.js';
import { PLAYER_BAR_HEIGHT } from '../../../lib/playerBarHeight.js';

interface QueueModalProps {
  user: User;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function computePosition(trigger: HTMLElement, panel: HTMLElement) {
  const triggerRect = trigger.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const margin = 8;
  const maxLeft = window.innerWidth - panelRect.width - margin;
  const left = clamp(triggerRect.right - panelRect.width, margin, maxLeft);
  const top = clamp(
    triggerRect.top - panelRect.height - margin,
    margin,
    window.innerHeight - panelRect.height - margin - PLAYER_BAR_HEIGHT,
  );
  return { top, left };
}

export function QueueModal({ user }: QueueModalProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setStyle(computePosition(trigger, panel));
    // Non-modal popover, but keyboard users still land inside the dialog on
    // open (mirrors ColumnConfigMenu's first-focusable pattern) instead of
    // tabbing through the page behind it.
    panel.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    return () => {
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const handleMouse = (e: MouseEvent) => {
      const target = e.target as Node;
      const element = target instanceof Element ? target : target.parentElement;
      // Ignore clicks inside the modal, its trigger, or any spawned context menu.
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target) ||
        element?.closest('[role="menu"]')
      ) {
        return;
      }
      setOpen(false);
    };
    const handleResize = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      setStyle(computePosition(trigger, panel));
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleMouse);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleMouse);
      window.removeEventListener('resize', handleResize);
    };
  }, [open]);

  return (
    <>
      <ControlButton
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        label="Queue"
        active={open}
      >
        <Icon name="mdi-playlist-music" size={18} />
      </ControlButton>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Queue"
            style={style}
            className={cn(
              'fixed z-50 flex w-[min(20rem,calc(100vw-1rem))] max-h-[60vh] flex-col overflow-hidden rounded-popover border border-outline bg-surface shadow-2xl',
            )}
          >
            <div className="flex items-center justify-between border-b border-outline px-3 py-2">
              <span className="text-sm font-semibold text-on-surface">Queue</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close queue"
                className="-m-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Icon name="mdi-close" size={18} />
              </button>
            </div>
            <div className="flex-1 min-h-0 p-2">
              <QueueList user={user} showHeader={false} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
