"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Writes the `theme` key the inline script in `app/layout.tsx` reads before
 * first paint. Without a writer that read would never find anything.
 * Returns whether the page is now dark.
 */
export function toggleTheme() {
  const next = document.documentElement.classList.toggle("dark");
  try {
    localStorage.setItem("theme", next ? "dark" : "light");
  } catch {
    // Private mode: the class still flipped for this page.
  }
  return next;
}

/**
 * The theme toggle: top-left on the signed-out `/`, and beside the account
 * menu in every signed-in header, at the avatar's 32px (`size="icon"`).
 * Both icons and both labels are always rendered and the `.dark`
 * class picks one of each, so server and client markup match without reading
 * the DOM, and the name says what a press will do.
 */
export function ThemeButton({
  size = "icon-lg",
}: {
  size?: "icon" | "icon-lg";
}) {
  return (
    <Button variant="ghost" size={size} onClick={() => toggleTheme()}>
      <Sun aria-hidden className="dark:hidden" />
      <Moon aria-hidden className="hidden dark:block" />
      <span className="sr-only dark:hidden">Switch to dark theme</span>
      <span className="sr-only hidden dark:inline">Switch to light theme</span>
    </Button>
  );
}
