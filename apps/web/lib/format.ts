/**
 * §7.1: `6 NOV`, not `11/06` — no badge pairs two numbers, and whitespace is
 * the only separator. Shared by the board and the table so one view cannot
 * drift into a different date shape from the other.
 */
export const shortDate = (value: Date) =>
  value.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * §7.1 again, with the time of day the activity log needs: `6 NOV 14:32`.
 * Three tokens, whitespace-separated, no divider — and the two numerals are
 * never adjacent because the month sits between them.
 */
export const shortDateTime = (value: Date) =>
  `${shortDate(value)} ${value.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;

/** A logged span: `1h 05m`, or `45m` under an hour. */
export function formatDuration(ms: number) {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
}

/** A running timer, ticking: `1:05:12`. */
export function formatClock(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}
