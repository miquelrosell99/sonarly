/** @type {import('tailwindcss').Config} */
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
      },
    },
  },
  plugins: [],
};
