import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User } from '@sonarly/shared';
import { cn } from '../../../lib/cn.js';
import { Icon } from '../../../components/ui/Icon.js';
import { ControlButton } from '../../../components/PlayerControls.js';
import { QueueList } from './QueueList.js';

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
    window.innerHeight - panelRect.height - margin,
  );
  return { top, left };
}

export function QueueModal({ user }: QueueModalProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    setStyle(computePosition(trigger, panel));
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
            aria-modal="true"
            aria-label="Queue"
            style={style}
            className={cn(
              'fixed z-50 flex w-80 max-h-[60vh] flex-col overflow-hidden rounded-xl border border-rule/50 bg-surface shadow-2xl',
            )}
          >
            <div className="flex items-center justify-between border-b border-rule/50 px-3 py-2">
              <span className="text-sm font-semibold text-fg-primary">Queue</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close queue"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
