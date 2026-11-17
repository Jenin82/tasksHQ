/**
 * Calendar dates (`YYYY-MM-DD`) and wall-clock times (`HH:MM`) in an IANA
 * zone. Your Time and the time entry form share these, so a list and the form
 * that edits it always read the same zone.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The Monday on or before a calendar date. */
export function weekStart(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

/** The zone this browser (or, on the server, this runtime) reports. */
export function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

function zonedParts(ms: number, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(ms);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

/** The calendar date `ms` falls on in `zone`. */
export function zonedDate(ms: number, zone: string) {
  const { year, month, day } = zonedParts(ms, zone);
  return `${year}-${month}-${day}`;
}

/** The date and minute-precision time `ms` shows in `zone`. */
export function zonedWallTime(ms: number, zone: string) {
  const { year, month, day, hour, minute } = zonedParts(ms, zone);
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

/** ISO 8601 with `zone`'s offset at `ms`, to the second: `2026-11-17T09:30:00+05:30`. */
export function zonedIsoString(ms: number, zone: string) {
  const { year, month, day, hour, minute, second } = zonedParts(ms, zone);
  const offset = Math.round(zoneOffset(ms, zone) / 60_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  const sign = offset < 0 ? "-" : "+";
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

/** How far `zone`'s wall clock is ahead of UTC at `ms`. */
function zoneOffset(ms: number, zone: string) {
  const { year, month, day, hour, minute, second } = zonedParts(ms, zone);
  return Date.UTC(+year, +month - 1, +day, +hour, +minute, +second) - Math.floor(ms / 1000) * 1000;
}

/**
 * The two instants a wall-clock time can map to, one per offset around it:
 * the second pass settles DST changes, and they differ only near a transition.
 */
function candidates(date: string, time: string, zone: string) {
  const wall = Date.parse(`${date}T${time}:00Z`);
  const first = wall - zoneOffset(wall, zone);
  return [first, wall - zoneOffset(first, zone)] as const;
}

/** The instant a wall-clock time in `zone` names. NaN when the date or time is malformed. */
export function zonedTime(date: string, time: string, zone: string) {
  return candidates(date, time, zone)[1];
}

/**
 * The instant a calendar date starts in `zone`. Where midnight does not exist
 * (a DST jump at 00:00), that is the first instant after the gap.
 */
export function zonedMidnight(date: string, zone: string) {
  const [first, second] = candidates(date, "00:00", zone);
  return zonedDate(second, zone) === date ? second : Math.max(first, second);
}
