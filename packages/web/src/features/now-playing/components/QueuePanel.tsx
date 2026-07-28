import type { User } from '@sonarly/shared';
import { QueueList } from './QueueList.js';

interface QueuePanelProps {
  user: User;
}

export function QueuePanel({ user }: QueuePanelProps) {
  return <QueueList user={user} title="Up next" />;
}
