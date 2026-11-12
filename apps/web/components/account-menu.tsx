"use client";

import { useRef, useState } from "react";
import { ProfileAvatar } from "@/components/profile-avatar";
import { ProfilePhotoDialog } from "@/components/profile-photo-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import type { SessionUser } from "@/lib/session";

export type AccountUser = Pick<SessionUser, "name" | "email" | "image">;

/**
 * The account menu at the right edge of every signed-in header — the top bar
 * and the signed-in `/`. The theme is not in here: it is an icon button
 * beside this trigger in both headers.
 */
export function AccountMenu({ user }: { user: AccountUser }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          ref={trigger}
          aria-label="Account"
          className="stutter grid size-8 shrink-0 place-items-center rounded-full border border-border outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-expanded:text-foreground"
        >
          <ProfileAvatar name={user.name} image={user.image} className="size-full" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => { if (settingsOpen) event.preventDefault(); }}
        >
          <DropdownMenuLabel>
            <p className="truncate">{user.name}</p>
            {/* Muted fails contrast on Steel; a foreground tint does not. */}
            <p className="truncate text-foreground/60">{user.email}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>Account settings</DropdownMenuItem>
          <DropdownMenuItem
            onSelect={async () => {
              // Navigate even if signOut rejects: `/` renders whatever the
              // server now believes — sign-in if the session ended, the
              // org list if it did not — rather than a menu that did nothing.
              try {
                await authClient.signOut();
              } finally {
                window.location.href = "/";
              }
            }}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfilePhotoDialog
        user={user}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        restoreFocus={() => trigger.current?.focus()}
      />
    </>
  );
}
