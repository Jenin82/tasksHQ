import { forbidden, notFound } from "next/navigation";
import { AccessError, TaskEditForbidden } from "@tasks/core/access";
import { DomainError } from "@tasks/core/errors";

/**
 * What every Server Action in this app returns to its form.
 *
 * `values` is what the caller submitted, echoed back on failure: React 19
 * resets an uncontrolled form once its action settles, so without it a refused
 * submission would also wipe what the user typed.
 */
export type ActionState = {
  error?: string;
  values?: Record<string, string>;
};

export const NO_ERROR: ActionState = {};

/**
 * PLAN §4.6 / §5's error mapping, in one place.
 *
 * `not_a_member` is 404 so org slugs stay non-enumerable; `forbidden` is a
 * real 403 (`app/forbidden.tsx`), which only a hand-made request can reach
 * since the UI hides controls a role cannot use. A `DomainError` — duplicate
 * slug, last-owner refusal — is the caller's own input and comes back as an
 * inline form error. Anything else is a bug and rethrows as a 500.
 *
 * AccessError extends DomainError, so it must be tested first.
 */
export function toActionState(
  error: unknown,
  values?: Record<string, string>,
): ActionState {
  // A task may become read-only while someone has the editor open.
  if (error instanceof TaskEditForbidden) return { error: error.message, values };
  if (error instanceof AccessError) {
    if (error.reason === "not_a_member") notFound();
    forbidden();
  }
  if (error instanceof DomainError) return { error: error.message, values };
  throw error;
}
