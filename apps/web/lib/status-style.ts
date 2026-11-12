import type { Status } from "@tasks/core/schema";

function swatch(label: string, color: string) {
  return { label, color, dot: `${color} bg-(--status-color)` };
}

export const STATUS_PALETTE = {
  gray: swatch("Grey", "[--status-color:var(--muted-foreground)]"),
  blue: swatch("Blue", "[--status-color:var(--primary)]"),
  green: swatch("Green", "[--status-color:#167446] dark:[--status-color:#54c68a]"),
  red: swatch("Red", "[--status-color:var(--destructive)]"),
  yellow: swatch("Yellow", "[--status-color:#806500] dark:[--status-color:#f2ce55]"),
  orange: swatch("Orange", "[--status-color:#b74b0b] dark:[--status-color:#fb9a55]"),
  purple: swatch("Purple", "[--status-color:#7839bd] dark:[--status-color:#c19af6]"),
  pink: swatch("Pink", "[--status-color:#b72c72] dark:[--status-color:#f28dbb]"),
} satisfies Record<NonNullable<Status["color"]>, ReturnType<typeof swatch>>;

export function statusDot(color: Status["color"]) {
  return STATUS_PALETTE[color ?? "gray"].dot;
}

export function statusColorClass(color: Status["color"]) {
  return STATUS_PALETTE[color ?? "gray"].color;
}

/**
 * Native form controls use the stutter register, with the chosen value in
 * the foreground (§7.4).
 */
export const SELECT_CLASS =
  "stutter text-foreground h-8 rounded-lg bg-input px-2 shadow-subtle-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
