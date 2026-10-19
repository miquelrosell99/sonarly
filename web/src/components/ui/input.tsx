// shadcn catalog copy, NORMALIZED per components/shadcn-bridge.md: the app
// input register (h-10, rounded-input, surface fill, accent focus border,
// ring-2 focus ring from --ring), no default shadow; placeholder text cites
// on-surface-variant. The `input` marker class is kept as the documented
// hook for feature CSS and the raw className="input" call sites that ride
// the .input layer in index.css.
import * as React from "react"

import { cn } from "@/lib/cn"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "input flex h-10 w-full rounded-input border border-input bg-surface px-3 text-sm text-foreground transition file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-on-surface-variant focus:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
