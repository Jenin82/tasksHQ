"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CHANGELOG, LATEST_CHANGELOG_ID, formatChangelogDate, hasUnseenChangelog } from "@/lib/changelog";

const SEEN_KEY = "tasks:changelog-seen";

/**
 * Seen state is per browser. The dot starts hidden so server HTML and the
 * first client render match; it is monochrome and still (§7.5, §7.6).
 */
export function ChangelogButton() {
  const [open, setOpen] = useState(false);
  const [unseen, setUnseen] = useState(false);

  useEffect(() => {
    try {
      setUnseen(hasUnseenChangelog(localStorage.getItem(SEEN_KEY)));
    } catch {
      // Without storage there is nothing to compare, so no dot.
    }
  }, []);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setUnseen(false);
    try {
      localStorage.setItem(SEEN_KEY, LATEST_CHANGELOG_ID);
    } catch {
      // The dot still clears for this page session.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unseen ? "What's new, unread updates" : "What's new"}
        >
          <Sparkles aria-hidden />
          {unseen && (
            <span
              aria-hidden
              data-slot="changelog-dot"
              className="absolute top-1 right-1 size-2 rounded-full bg-foreground ring-2 ring-background"
            />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogTitle className="pr-10">What&apos;s new</DialogTitle>
        {/* Focusable so the keyboard can scroll it; Radix focuses it first. */}
        <div
          role="region"
          tabIndex={0}
          aria-label="Release notes"
          className="-mx-1 mt-4 max-h-[60dvh] divide-y overscroll-contain divide-border overflow-y-auto rounded-sm px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {CHANGELOG.map((entry) => (
            <article key={entry.id} className="py-4 first:pt-0 last:pb-0">
              {/* `stutter` is muted; text on the popover is a foreground tint (§7.4). */}
              <time dateTime={entry.date} className="stutter numeral text-popover-foreground/70!">
                {formatChangelogDate(entry.date)}
              </time>
              <h3 className="mt-1 text-sm font-medium">{entry.title}</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-popover-foreground/80">
                {entry.items.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <div className="mt-4 border-t border-border pt-4">
          {/* Close straight away instead of waiting for the route to load. */}
          <Link
            href="/docs"
            onNavigate={() => setOpen(false)}
            className="rounded-sm text-sm text-popover-foreground/70 underline-offset-2 outline-none hover:underline transition-colors hover:text-popover-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Read the guide
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
