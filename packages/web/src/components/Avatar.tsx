import { cn } from '../lib/cn.js';
import type { User } from '@sonarly/shared';

interface AvatarProps {
  user: User;
  className?: string;
  variant?: 'accent' | 'surface';
}

export function Avatar({ user, className, variant = 'accent' }: AvatarProps) {
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
        'flex items-center justify-center rounded-full text-xs font-bold',
        variant === 'accent'
          ? 'bg-accent text-bg-primary'
          : 'bg-surface text-muted',
        className,
      )}
    >
      {initials}
    </div>
  );
}
