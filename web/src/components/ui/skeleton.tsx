// shadcn catalog copy, NORMALIZED per components/shadcn-bridge.md: the
// app skeleton register is rounded-item on surface-container-high (no
// accent tint); the reduced-motion guard is global (index.css) plus the
// motion-reduce variant below.
import { cn } from "@/lib/cn"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse motion-reduce:animate-none rounded-item bg-surface-container-high", className)}
      {...props}
    />
  )
}

export { Skeleton }
