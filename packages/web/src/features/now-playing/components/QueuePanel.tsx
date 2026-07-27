import type { User } from '@sonarly/shared';
import { Queue } from './Queue.js';

interface QueuePanelProps {
  user: User;
}

export function QueuePanel({ user }: QueuePanelProps) {
  return <Queue user={user} />;
}
