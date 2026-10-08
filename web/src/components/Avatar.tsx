import { cn } from '../lib/cn.js';
import type { User } from '../types';

interface AvatarProps {
  user: User;
  className?: string;
  /** 'default' tints the initials tile like a raised surface; 'surface' is flat. */
  variant?: 'default' | 'surface';
}

export function Avatar({ user, className, variant = 'default' }: AvatarProps) {
  const initials = user.name && user.surname
    ? `${user.name[0]}${user.surname[0]}`.toUpperCase()
    : user.name
      ? user.name[0].toUpperCase()
      : user.username[0].toUpperCase();

  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        className={cn('rounded-full object-cover', className)}
      />
    );
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full text-xs font-semibold',
        variant === 'default'
          ? 'bg-surface-hover text-fg-primary'
          : 'bg-surface text-muted',
        className,
      )}
    >
      {initials}
    </div>
  );
}
