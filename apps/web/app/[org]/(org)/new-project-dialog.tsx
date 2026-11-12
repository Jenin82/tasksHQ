"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { NewProjectForm } from "./new-project-form";

// `/[org]`'s one primary button. No close-on-success handling: a created
// project redirects into its board, which leaves this page.
export function NewProjectDialog({ orgSlug }: { orgSlug: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>New project</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>
          A board of tasks, for the people you add to it.
        </DialogDescription>
        <div className="mt-5">
          <NewProjectForm orgSlug={orgSlug} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
