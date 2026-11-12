const dueDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** A due date is a calendar date, so it must display the same day everywhere. */
export function formatTaskDueDate(date: string) {
  return dueDate.format(new Date(`${date}T00:00:00Z`));
}

export function isPastTaskDueDate(date: string) {
  return date < new Date().toISOString().slice(0, 10);
}
