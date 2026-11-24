"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CreateTeamForm } from "./create-team-form";

// The signed-in `/`'s one primary button, and the sidebar's + beside
// Teams. No close-on-success handling: a created team redirects into
// itself, which leaves the page (and remounts the team-keyed sidebar).
export function NewTeamDialog({ trigger = <Button>New team</Button> }: { trigger?: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogTitle>New team</DialogTitle>
        <DialogDescription>
          Projects, people and tasks all live inside a team.
        </DialogDescription>
        <CreateTeamForm />
      </DialogContent>
    </Dialog>
  );
}
