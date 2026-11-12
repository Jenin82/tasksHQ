/**
 * A rule the caller broke, not a bug: a bad slug, a duplicate key, the
 * last-owner rule. Callers render the message; anything else is a 500.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

/**
 * Whether `error` is SQLite refusing a write on `kind` of constraint. Used
 * where a domain pre-check can be raced: the check passes, a concurrent write
 * lands, and the constraint catches what the check missed — which should read
 * as the check's sentence, not a 500. Drizzle wraps the D1 error, so the whole
 * `cause` chain is searched.
 */
export function isConstraintError(
  error: unknown,
  kind: "UNIQUE" | "FOREIGN KEY" | "NOT NULL",
  // SQLite names the columns for UNIQUE, e.g. "project.org_id, project.slug".
  column?: string,
): boolean {
  for (let e = error; e instanceof Error; e = e.cause) {
    if (
      e.message.includes(`${kind} constraint failed`) &&
      (!column || e.message.includes(column))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Length caps, enforced in the domain so web and MCP cannot disagree. Counted
 * in code points, so an emoji costs one character, not two.
 */
export const MAX_LENGTH = {
  name: 80,
  title: 200,
  description: 10_000,
  comment: 10_000,
} as const;

export function assertMaxLength(label: string, value: string, max: number) {
  if ([...value].length > max) {
    throw new DomainError(`${label} must be at most ${max} characters.`);
  }
}
