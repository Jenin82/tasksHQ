"use client";

import { useActionState, useState } from "react";
import { suggestProjectKey, suggestSlug } from "@tasks/core/slug";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NO_ERROR } from "@/lib/action-result";
import { createProjectAction } from "./actions";

export function NewProjectForm({ orgSlug }: { orgSlug: string }) {
  const [state, action, pending] = useActionState(
    createProjectAction,
    NO_ERROR,
  );
  const [name, setName] = useState("");
  const [slugOverride, setSlugOverride] = useState<string | null>(null);
  const [keyOverride, setKeyOverride] = useState<string | null>(null);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="org" value={orgSlug} />

      {/* Laid out for the dialog it lives in: name on its own row, slug and
          key beside each other, the action last. */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="project-name" className="stutter">
            Name
          </Label>
          <Input
            id="project-name"
            name="name"
            required
            placeholder="Website"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-slug" className="stutter">
              Slug
            </Label>
            <Input
              id="project-slug"
              name="slug"
              required
              placeholder="website"
              autoCapitalize="none"
              spellCheck={false}
              value={slugOverride ?? suggestSlug(name, "project")}
              onChange={(event) => setSlugOverride(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-key" className="stutter">
              Key
            </Label>
            <Input
              id="project-key"
              name="key"
              required
              placeholder="WEB"
              className="numeral uppercase"
              autoCapitalize="characters"
              spellCheck={false}
              value={keyOverride ?? suggestProjectKey(name)}
              onChange={(event) => setKeyOverride(event.target.value)}
            />
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        The key prefixes every task in the project, as in WEB-42. It cannot be
        changed later.
      </p>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Creating" : "Create project"}
      </Button>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
