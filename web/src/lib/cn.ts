import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge drops UNKNOWN utility names when resolving conflicts
// (fleet production hit 2026-10-19, notees migration): the app's custom
// token names must be registered or `text-bg-primary` gets eaten next to
// `text-sm`. Registration covers the app role tokens, the shadcn catalog
// alias keys (tailwind.config.js colors), the radius token family, and the
// custom font sizes/families.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        'bg-primary',
        'fg-primary',
        'fg-secondary',
        'surface',
        'surface-hover',
        'rule',
        'muted',
        'accent',
        'danger',
        'success',
        'warning',
        'info',
        'background',
        'foreground',
        'card',
        'card-foreground',
        'popover',
        'popover-foreground',
        'primary',
        'primary-foreground',
        'secondary',
        'secondary-foreground',
        'muted-foreground',
        'accent-foreground',
        'destructive',
        'destructive-foreground',
        'border',
        'input',
        'ring',
      ],
      radius: ['card', 'sheet', 'button', 'input', 'item', 'popover'],
      // tailwind-merge v3 theme groups: 'text' = font-size, 'font' = family.
      text: ['2xs', '3xs', 'badge'],
      font: ['display'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
