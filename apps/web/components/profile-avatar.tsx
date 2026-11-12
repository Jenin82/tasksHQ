"use client";

import { Avatar } from "radix-ui";
import { cn } from "@/lib/utils";

export function ProfileAvatar({ name, image, className }: {
  name: string;
  image?: string | null;
  className?: string;
}) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();

  return (
    <Avatar.Root
      aria-hidden
      title={name}
      className={cn("grid shrink-0 place-items-center overflow-hidden rounded-full", className)}
    >
      <Avatar.Image src={image || undefined} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
      <Avatar.Fallback>{initials}</Avatar.Fallback>
    </Avatar.Root>
  );
}
