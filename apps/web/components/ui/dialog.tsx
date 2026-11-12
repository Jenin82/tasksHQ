"use client"

import * as React from "react"
import { cn } from "cn"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

// shadcn's dialog, trimmed to what the new-organization and new-project
// dialogs use. Radix traps focus, closes on Esc and overlay click, and
// returns focus to the trigger. §7.4: popover surface + inset hairline, 16px like every panel, no
// drop shadow; text on it is foreground, never muted. 140ms settle (§7.6).
function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger(
  props: React.ComponentProps<typeof DialogPrimitive.Trigger>
) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogContent({
  className,
  children,
  closeDisabled,
  showClose = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { closeDisabled?: boolean; showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className="fixed inset-0 z-50 bg-black/60 duration-140 ease-settle data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-popover p-6 text-foreground shadow-subtle outline-none duration-140 ease-settle data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showClose && <DialogClose disabled={closeDisabled} className="absolute top-4 right-4" />}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function DialogClose({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return (
    <DialogPrimitive.Close
      aria-label="Close"
      className={cn(
        "grid size-8 place-items-center rounded-full text-foreground/60 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <XIcon aria-hidden className="size-4" />
    </DialogPrimitive.Close>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-xl", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("mt-2 text-sm text-foreground/70", className)}
      {...props}
    />
  )
}

export { Dialog, DialogTrigger, DialogContent, DialogClose, DialogTitle, DialogDescription }
