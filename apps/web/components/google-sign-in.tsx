"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/** §7.5: the one `--primary` element on the sign-in screen. */
export function GoogleSignIn({ callbackURL }: { callbackURL: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  // On success the page navigates to Google, so the button stays pending.
  // better-auth reports it as `{ error }` rather than throwing; a network
  // failure still rejects. Either way the button must come back.
  const fail = () => {
    setPending(false);
    setError(true);
  };

  return (
    <>
      <Button
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(false);
          try {
            const result = await authClient.signIn.social({
              provider: "google",
              callbackURL,
            });
            if (result.error) fail();
          } catch {
            fail();
          }
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
          <path
            fill="currentColor"
            d="M12 10.2v3.9h5.5a4.7 4.7 0 0 1-2 3.1l3.2 2.5c1.9-1.7 3-4.3 3-7.3 0-.7-.1-1.4-.2-2.1H12Z"
          />
          <path
            fill="currentColor"
            d="M5.3 14.3 4.6 15l-2.5 2a10 10 0 0 0 9 5.5c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.9 5.9 0 0 1-5.6-4Z"
          />
          <path
            fill="currentColor"
            d="M2.1 7a9.9 9.9 0 0 0 0 9l3.2-2.5a5.9 5.9 0 0 1 0-3.8L2.1 7Z"
          />
          <path
            fill="currentColor"
            d="M11.1 4.1c1.5 0 2.8.5 3.9 1.5l2.8-2.8A10 10 0 0 0 2.1 7l3.2 2.5a5.9 5.9 0 0 1 5.8-5.4Z"
          />
        </svg>
        {pending ? "Opening Google" : "Continue with Google"}
      </Button>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Google sign-in could not start. Try again.
        </p>
      ) : null}
    </>
  );
}
