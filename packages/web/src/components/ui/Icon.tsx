import { cn } from '../../lib/cn.js';

interface IconProps {
  name: string;
  size?: number;
  className?: string;
  title?: string;
}

export function Icon({ name, size = 24, className, title }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden={!title}
      role={title ? 'img' : undefined}
      className={cn('inline-block shrink-0', className)}
    >
      {title && <title>{title}</title>}
      <use href={`/mdi-sprite.svg?v=2#${name}`} />
    </svg>
  );
}
