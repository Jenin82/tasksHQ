"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NO_ERROR, type ActionState } from "@/lib/action-result";

export function ProjectDetailsSettings({
  orgSlug,
  name,
  slug,
  action,
}: {
  orgSlug: string;
  name: string;
  slug: string;
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, submit, pending] = useActionState(action, NO_ERROR);

  return (
    <section className="mb-8 rounded-2xl bg-card p-6 shadow-subtle">
      <h2 className="text-xl">Project details</h2>
      <form action={submit} className="mt-4 grid gap-4 border-t border-border pt-4">
        <div>
          <Label htmlFor="project-name" className="stutter">Name</Label>
          <Input
            id="project-name"
            name="name"
            required
            maxLength={80}
            defaultValue={state.values?.name ?? name}
            readOnly={pending}
            aria-invalid={Boolean(state.error)}
            aria-describedby={state.error ? "project-details-error" : undefined}
            className="mt-2 max-w-sm"
          />
        </div>
        <div>
          <Label htmlFor="project-slug" className="stutter">Slug</Label>
          <div className="mt-2 flex max-w-sm items-center gap-2">
            <span aria-hidden className="max-w-[45%] shrink-0 truncate text-sm text-muted-foreground">/{orgSlug}/</span>
            <Input
              id="project-slug"
              name="slug"
              className="min-w-0"
              required
              minLength={2}
              maxLength={48}
              pattern="[a-z0-9]([a-z0-9\-]*[a-z0-9])?"
              title="Lowercase letters, numbers and hyphens, starting and ending with a letter or number."
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              defaultValue={state.values?.slug ?? slug}
              readOnly={pending}
              aria-invalid={Boolean(state.error)}
              aria-describedby={state.error ? "project-slug-help project-details-error" : "project-slug-help"}
            />
          </div>
          <p id="project-slug-help" className="mt-2 text-sm text-muted-foreground">
            Changing the slug changes the project&apos;s URLs. Old links keep redirecting.
          </p>
        </div>
        <div>
          <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        </div>
        {state.error ? (
          <p id="project-details-error" role="alert" className="text-sm text-destructive">{state.error}</p>
        ) : state.values && !pending ? (
          <p role="status" className="text-sm text-muted-foreground">Project details saved.</p>
        ) : null}
      </form>
    </section>
  );
}
