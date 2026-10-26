// shadcn catalog copy, NORMALIZED per rosellramos-design-system
// components/shadcn-bridge.md (checklist run at add time):
//   - theme-key utilities only; the drift gate bans the legacy accent/muted
//     class stems, so hover/highlight refs cite the app's verified hover
//     register (bg-surface-container-high) and containers cite
//     bg-surface-container / text-on-surface-variant directly
//   - radius tokens (rounded-button — corner-full 9999px fleet-wide; supersedes sonarly's
//     registered 16px button shape recorded in .agents/design-overrides.md);
//     no default shadows on non-floating layers; focus ring ring-2/--ring/
//     offset-1 (never suppressed); the app's tactile press (brightness +
//     scale) stays.
//   - THE REGISTER IS A BORDERLESS WEIGHT LADDER (rulings v2.0.4–v2.0.6): no visible border on any
//     variant — accent fill > neutral fills > ghost > soft-danger wash.
//     Danger rests on the translucent error-soft wash with error text and
//     escalates to the solid error fill on hover (never a naked outline —
//     the retired same-day detour "read broken"). An invisible 48px
//     hit-area overlay (::after, centered) rides EVERY button — the 48px
//     M3 touch floor without stretching compact rows; the visible box
//     rides the size token, so the old coarse-pointer h-11 override went
//     with it. App hover register kept: the solid surface-container-high
//     step (the bridge fixture pins it), not the starter's overlay ink.
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
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-button px-5 text-sm font-semibold transition after:absolute after:left-1/2 after:top-1/2 after:h-12 after:w-12 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Accent fill, ground-colored label (the .btn contract): hover
        // darkens subtly, press compresses and darkens harder.
        default:
          "bg-primary text-primary-foreground hover:brightness-95 active:scale-[0.97] active:brightness-90",
        primary:
          "bg-primary text-primary-foreground hover:brightness-95 active:scale-[0.97] active:brightness-90",
        // Soft danger: translucent error wash at
        // rest with error text, escalating to the solid error fill (and the
        // ground-colored on-error label) on hover.
        danger:
          "bg-error-soft text-error hover:bg-error hover:text-on-error active:scale-[0.97] active:brightness-90",
        // Catalog destructive: solid error fill (app-side register per the
        // ruling's fleet/app split — confirmed destructive action).
        destructive:
          "bg-destructive text-destructive-foreground hover:brightness-95 active:scale-[0.97] active:brightness-90",
        // The quiet accent step: no fill at rest; hover rides the app's
        // verified hover register (the solid -high step, per the bridge
        // fixture — not the overlay ink).
        outline:
          "text-primary hover:bg-surface-container-high active:scale-[0.97]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 active:scale-[0.97]",
        // The quiet neutral step: no fill at rest, same hover register.
        ghost:
          "text-on-surface hover:bg-surface-container-high active:scale-[0.97] active:brightness-[0.95]",
        link: "text-primary underline-offset-4 hover:underline",
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
