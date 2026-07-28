import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type NotificationType = 'success' | 'error' | 'info';

export interface Notification {
  id: string;
  message: string;
  type: NotificationType;
}

interface NotificationContextValue {
  notify: (message: string, type?: NotificationType) => void;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

const DISMISS_MS = 4000;
const ENTER_MS = 250;
const EXIT_MS = 200;

export function useNotification(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotification must be used within NotificationProvider');
  return ctx;
}

function NotificationItem({
  notification,
  onDone,
}: {
  notification: Notification;
  onDone: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const card = cardRef.current;
    const progress = progressRef.current;
    if (!card || !progress) return;

    const enter = card.animate(
      [
        { opacity: 0, transform: 'translateX(1rem) scale(0.96)' },
        { opacity: 1, transform: 'translateX(0) scale(1)' },
      ],
      { duration: ENTER_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }
    );

    const bar = progress.animate(
      [{ width: '100%' }, { width: '0%' }],
      { duration: DISMISS_MS, easing: 'linear', fill: 'forwards' }
    );

    const timeout = setTimeout(() => setExiting(true), DISMISS_MS);

    return () => {
      clearTimeout(timeout);
      enter.cancel();
      bar.cancel();
    };
  }, []);

  useEffect(() => {
    if (!exiting) return;
    const card = cardRef.current;
    if (!card) return;
    const exit = card.animate(
      [
        { opacity: 1, transform: 'translateX(0) scale(1)' },
        { opacity: 0, transform: 'translateX(1rem) scale(0.96)' },
      ],
      { duration: EXIT_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }
    );
    exit.onfinish = onDone;
    return () => exit.cancel();
  }, [exiting, onDone]);

  const bgClass =
    notification.type === 'error'
      ? 'bg-red-500'
      : notification.type === 'success'
        ? 'bg-green-500'
        : 'bg-gray-500';

  const cardClass =
    notification.type === 'error'
      ? 'bg-surface text-red-500 border-red-500/30'
      : notification.type === 'success'
        ? 'bg-surface text-green-500 border-green-500/30'
        : 'bg-surface text-fg-primary border-rule';

  return (
    <div
      ref={cardRef}
      className={`flex max-w-sm flex-col rounded-md border shadow-lg ${cardClass}`}
      role="alert"
      style={{ opacity: 0 }}
    >
      <div className="h-1 w-full overflow-hidden rounded-t-md bg-black/10">
        <div ref={progressRef} className={`h-full w-full ${bgClass}`} />
      </div>
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="flex-1 text-sm">{notification.message}</span>
        <button
          onClick={() => setExiting(true)}
          className="text-xs font-medium opacity-70 hover:opacity-100"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const notify = useCallback((message: string, type: NotificationType = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setNotifications((prev) => [...prev, { id, message, type }]);
  }, []);

  const remove = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <NotificationContext.Provider value={{ notify }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {notifications.map((n) => (
          <NotificationItem key={n.id} notification={n} onDone={() => remove(n.id)} />
        ))}
      </div>
    </NotificationContext.Provider>
  );
}
