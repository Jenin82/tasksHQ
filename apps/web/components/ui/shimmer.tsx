import { cn } from "@/lib/utils";

export function Shimmer({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative block overflow-hidden rounded-md bg-foreground/10 motion-safe:after:absolute motion-safe:after:inset-0 motion-safe:after:animate-shimmer motion-safe:after:bg-linear-to-r motion-safe:after:from-transparent motion-safe:after:via-foreground/10 motion-safe:after:to-transparent",
        className,
      )}
    />
  );
}
