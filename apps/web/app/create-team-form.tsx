"use client";

import { useActionState, useState } from "react";
import { suggestSlug } from "@tasks/core/slug";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NO_ERROR } from "@/lib/action-result";
import { createTeamAction } from "./actions";

export function CreateTeamForm() {
  const [state, action, pending] = useActionState(createTeamAction, NO_ERROR);
  const [name, setName] = useState("");
  const [slugOverride, setSlugOverride] = useState<string | null>(null);

  return (
    <form action={action} className="mt-6 flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name" className="stutter">
          Name
        </Label>
        <Input
          id="name"
          name="name"
          required
          placeholder="Acme"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="slug" className="stutter">
          Slug
        </Label>
        <Input
          id="slug"
          name="slug"
          required
          placeholder="acme"
          autoCapitalize="none"
          spellCheck={false}
          value={slugOverride ?? suggestSlug(name, "team")}
          onChange={(event) => setSlugOverride(event.target.value)}
        />
        <p className="text-sm text-muted-foreground">
          Lowercase letters, numbers and hyphens. It becomes the first part of
          every URL in the team.
        </p>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Creating" : "Create team"}
      </Button>
    </form>
  );
}
