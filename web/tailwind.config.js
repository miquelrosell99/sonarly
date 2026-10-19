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
        // Buttons are corner-full (9999px) fleet-wide — owner ruling
        // 2026-10-19 (M3 corner-full at every size), applied 2026-10-19.
        card: '20px',
        sheet: '28px',
        button: '9999px',
        input: '12px',
        item: '8px',
        popover: '8px',
      },
      colors: {
        /* Canonical Material You roles (rosellramos-design-system law/spec.md
           §2; owner ruling 2026-10-19 single-track alignment). Values are
           HSL triplets in src/index.css, consumed as hsl(var(--role) /
           <alpha-value>). Cite the role, never a hue.
           ⚠ --accent is NOT the seed — per the shadcn bridge it is the HOVER
           surface (--md-sys-color-hover-overlay); the seed is `primary`.
           ⚠ `muted` is a CONTAINER (surface-container); muted TEXT is
           muted-foreground (on-surface-variant). */
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
        muted: 'hsl(var(--muted) / <alpha-value>)',
        'muted-foreground': 'hsl(var(--muted-foreground) / <alpha-value>)',
        accent: 'hsl(var(--accent) / <alpha-value>)',
        'accent-foreground': 'hsl(var(--accent-foreground) / <alpha-value>)',
        destructive: 'hsl(var(--destructive) / <alpha-value>)',
        'destructive-foreground':
          'hsl(var(--destructive-foreground) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        /* Roles the app cites directly (beyond the alias layer above). */
        surface: 'hsl(var(--md-sys-color-surface) / <alpha-value>)',
        'on-primary': 'hsl(var(--md-sys-color-on-primary) / <alpha-value>)',
        'on-surface': 'hsl(var(--md-sys-color-on-surface) / <alpha-value>)',
        'on-surface-variant':
          'hsl(var(--md-sys-color-on-surface-variant) / <alpha-value>)',
        'surface-container-high':
          'hsl(var(--md-sys-color-surface-container-high) / <alpha-value>)',
        outline: 'hsl(var(--md-sys-color-outline) / <alpha-value>)',
        error: 'hsl(var(--md-sys-color-error) / <alpha-value>)',
        success: 'hsl(var(--md-sys-color-success) / <alpha-value>)',
        warning: 'hsl(var(--md-sys-color-warning) / <alpha-value>)',
        info: 'hsl(var(--md-sys-color-info) / <alpha-value>)',
      },
    },
  },
  plugins: [animate],
};
