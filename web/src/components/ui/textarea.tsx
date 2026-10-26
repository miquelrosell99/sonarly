// shadcn catalog copy, NORMALIZED per components/shadcn-bridge.md — with the
// fleet text-field register (law/spec.md, same as
// input.tsx: the UNDERLINE field is the fleet default for labeled form
// fields (transparent, no box, straight bottom hairline; focus paints a 2px
// accent underline — the underline IS the focus indicator, so the field opts
// out of the app-global focus ring). The BOXED variant is reserved for dense
// toolbar rows and compact in-row edits; call sites in those registers pass
// variant="boxed".
import * as React from "react"

import { cn } from "@/lib/cn"

const variantClasses = {
  underline:
    "rounded-none border-0 border-b border-outline bg-transparent px-0 focus:border-b-2 focus:border-primary focus-visible:ring-0",
  boxed:
    "rounded-input border border-input bg-surface px-3 focus:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
} as const

export type TextareaVariant = keyof typeof variantClasses

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea"> & { variant?: TextareaVariant }
>(({ className, variant = "underline", ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full py-2 text-sm placeholder:text-on-surface-variant focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
