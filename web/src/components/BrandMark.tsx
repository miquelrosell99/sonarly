// The Signal Archive mark as an inline symbol: the open sweep ring follows
// the text color (currentColor) and the echo dot follows --accent. Copper by
// default, the user's accent when one is chosen, true monochrome under the
// monochrome accent — the static app-icon.png tile cannot do this.
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M 88.1 28 A 44 44 0 1 0 88.1 72 L 82.9 69 A 38 38 0 1 1 82.9 31 Z"
      />
      <circle cx="85.5" cy="70.5" r="8.5" fill="hsl(var(--accent))" />
    </svg>
  );
}
