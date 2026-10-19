// shadcn catalog copy, NORMALIZED per components/shadcn-bridge.md: same
// input register as input.tsx (rounded-input, surface fill, no default
// shadow, ring-2 focus ring from --ring).
import * as React from "react"

import { cn } from "@/lib/cn"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-input border border-input bg-surface px-3 py-2 text-sm placeholder:text-on-surface-variant focus:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
