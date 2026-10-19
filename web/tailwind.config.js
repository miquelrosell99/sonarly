/** @type {import('tailwindcss').Config} */
import animate from 'tailwindcss-animate';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    // Spec grid: 480 / 768 / 1024 / 1440 (was 640 / 768 / 1024 / 1280 — only
    // sm and xl moved). Usages that must keep their old boundary use
    // explicit min-[640px]/min-[1280px] arbitrary variants.
    screens: {
      sm: '480px',
      md: '768px',
      lg: '1024px',
      xl: '1440px',
    },
    extend: {
      fontFamily: {
        sans: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Small end the app actually uses (badges, kbd hints, chart axes).
        '2xs': ['0.625rem', { lineHeight: '1rem' }],
        // 11px helper/hint tier (slider ends, input explanations).
        '3xs': ['0.6875rem', { lineHeight: '1rem' }],
        // The explicit-tag glyph scales with its parent title (em-relative on
        // purpose — ExplicitTitle renders titles at several sizes).
        badge: ['0.65em', { lineHeight: '1' }],
      },
      borderRadius: {
        // Radius tokens (design system): surfaces, sheets, controls, rows.
        card: '20px',
        sheet: '28px',
        button: '16px',
        input: '12px',
        item: '8px',
        popover: '8px',
      },
      colors: {
        'bg-primary': 'hsl(var(--bg-primary) / <alpha-value>)',
        'fg-primary': 'hsl(var(--fg-primary) / <alpha-value>)',
        'fg-secondary': 'hsl(var(--fg-secondary) / <alpha-value>)',
        surface: 'hsl(var(--surface) / <alpha-value>)',
        'surface-hover': 'hsl(var(--surface-hover) / <alpha-value>)',
        rule: 'hsl(var(--rule) / <alpha-value>)',
        muted: 'hsl(var(--muted) / <alpha-value>)',
        accent: 'hsl(var(--accent) / <alpha-value>)',
        danger: 'hsl(var(--danger) / <alpha-value>)',
        success: 'hsl(var(--success) / <alpha-value>)',
        warning: 'hsl(var(--warning) / <alpha-value>)',
        info: 'hsl(var(--info) / <alpha-value>)',
        /* shadcn catalog theme keys — aliases defined in src/index.css; the
           catalog reads these (bg-background, text-muted-foreground, …).
           Deliberately absent, because the names already own app meanings:
           `muted` (muted TEXT here, not a container) and `accent` (the brand
           SEED here, not shadcn's hover surface — use surface-hover for
           that). See the alias-layer comment in index.css. */
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        card: 'hsl(var(--card) / <alpha-value>)',
        'card-foreground': 'hsl(var(--card-foreground) / <alpha-value>)',
        popover: 'hsl(var(--popover) / <alpha-value>)',
        'popover-foreground': 'hsl(var(--popover-foreground) / <alpha-value>)',
        primary: 'hsl(var(--primary) / <alpha-value>)',
        'primary-foreground': 'hsl(var(--primary-foreground) / <alpha-value>)',
        secondary: 'hsl(var(--secondary) / <alpha-value>)',
        'secondary-foreground': 'hsl(var(--secondary-foreground) / <alpha-value>)',
        'muted-foreground': 'hsl(var(--muted-foreground) / <alpha-value>)',
        'accent-foreground': 'hsl(var(--accent-foreground) / <alpha-value>)',
        destructive: 'hsl(var(--destructive) / <alpha-value>)',
        'destructive-foreground':
          'hsl(var(--destructive-foreground) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
      },
    },
  },
  plugins: [animate],
};
