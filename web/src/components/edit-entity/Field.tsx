export function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-fg-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}

export function ReadOnlyValue({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-10 items-center rounded-input border border-rule bg-surface px-3 text-sm text-fg-primary">
      {children}
    </div>
  );
}
