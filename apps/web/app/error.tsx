"use client";

import { Button } from "@/components/ui/button";

/**
 * PLAN §4.12's missing half of "failed Server Action".
 *
 * A refusal the domain layer names — a duplicate slug, a last-owner rule, a
 * 403 — never reaches here: `toActionState` turns it into inline form text or
 * into `app/forbidden.tsx`. This catches what is left, which is only ever a
 * bug: an exception thrown while a page renders, or one a Server Action
 * rethrows. Without this file that lands on the framework's own default page,
 * which is not this app's voice and offers no way back.
 *
 * The thrown message is deliberately not rendered — in production it is
 * replaced by a digest before it reaches the browser anyway, and a stack from
 * a server render is not the reader's business. The digest is shown when
 * there is one, since it is the only handle on the matching server-log line.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-subtle">
        <p className="stutter numeral">500</p>
        <h1 className="mt-3 text-2xl">
          That did not load
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          Something went wrong on our side while building this page. Trying
          again often clears it. If it does not, the error is in the server log
          for whoever runs this app.
        </p>

        {/* §7.5: the view's one `--primary` element. */}
        <Button onClick={reset} className="mt-8">
          Try again
        </Button>

        {error.digest ? (
          <p className="stutter numeral mt-8">{error.digest}</p>
        ) : null}
      </div>
    </main>
  );
}
