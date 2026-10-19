// shadcn catalog copy, NORMALIZED per rosellramos-design-system
// components/shadcn-bridge.md (checklist run at add time):
//   - theme-key utilities only; the drift gate bans the legacy accent/muted
//     class stems, so hover/highlight refs cite the app's verified hover
//     register (bg-surface-container-high) and containers cite
//     bg-surface-container / text-on-surface-variant directly
//   - radius tokens (rounded-button — corner-full 9999px fleet-wide; supersedes sonarly's
//     registered 16px button shape recorded in .agents/design-overrides.md);
//     no default shadows on
//     non-floating layers; focus ring ring-2/--ring/offset-1 (never
//     suppressed); the app's tactile press (brightness + scale) and the
//     coarse-pointer 44px touch floor live in the base.
//   - THE APP PRIMITIVE: this file also hosts the sonarly Button contract
//     (the old components/ui/Button.tsx): primary/ghost/danger variants,
//     the loading register (spinner + aria-busy + disabled). The old
//     .btn/.btn-ghost/.btn-danger marker classes retired with the last raw
//     call sites and their index.css blocks (migration 2026-10-19) — no
//     feature CSS cites them anymore.
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/cn"
import { Icon } from "@/components/ui/Icon"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-button px-5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [@media(pointer:coarse)]:h-11",
  {
    variants: {
      variant: {
        // Accent fill, ground-colored label (the .btn contract): hover
        // darkens subtly, press compresses and darkens harder.
        default:
          "border border-primary bg-primary text-primary-foreground hover:brightness-95 active:scale-[0.97] active:brightness-90",
        primary:
          "border border-primary bg-primary text-primary-foreground hover:brightness-95 active:scale-[0.97] active:brightness-90",
        // App danger contract: surface button, error text, hover fills.
        danger:
          "border border-outline bg-surface text-error hover:border-error hover:bg-error hover:text-on-primary active:scale-[0.97] active:brightness-90",
        // Catalog destructive: solid error fill.
        destructive:
          "border border-destructive bg-destructive text-destructive-foreground hover:brightness-95 active:scale-[0.97] active:brightness-90",
        outline:
          "border border-input bg-surface hover:bg-surface-container-high hover:text-on-surface active:scale-[0.97]",
        secondary:
          "border border-secondary bg-secondary text-secondary-foreground hover:bg-secondary/80 active:scale-[0.97]",
        // App ghost contract keeps the hover border raise.
        ghost:
          "border border-outline bg-surface text-on-surface hover:border-on-surface-variant hover:bg-surface-container-high active:scale-[0.97] active:brightness-[0.95]",
        link: "border-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-8 text-base",
        icon: "h-10 w-10 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** App contract: spinner + aria-busy + disabled while work is in flight. */
  loading?: boolean
}

// Marker classes retired 2026-10-19: the last raw .btn/.btn-ghost/.btn-danger
// call sites now compose this primitive, and the index.css register blocks
// went with them.

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    if (asChild) {
      // Slot composes onto the child element; the loading spinner register
      // needs a wrapper element, so asChild renders children as-is.
      return (
        <Comp
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          disabled={disabled}
          {...props}
        >
          {children}
        </Comp>
      )
    }
    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size, className }),
        )}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && (
          <Icon
            name="mdi-loading"
            size={16}
            className="animate-spin motion-reduce:animate-none"
          />
        )}
        {children}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
