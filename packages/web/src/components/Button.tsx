export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }) {
  const className = variant === 'primary' ? 'btn' : 'btn-ghost';
  return (
    <button className={className} {...props}>
      {children}
    </button>
  );
}
