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
