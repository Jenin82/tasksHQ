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
import { CreateOrgForm } from "./create-org-form";

// The signed-in `/`'s one primary button, and the sidebar's + beside
// Organizations. No close-on-success handling: a created org redirects into
// itself, which leaves the page (and remounts the org-keyed sidebar).
export function NewOrgDialog({ trigger = <Button>New organization</Button> }: { trigger?: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogTitle>New organization</DialogTitle>
        <DialogDescription>
          Projects, people and tasks all live inside an organization.
        </DialogDescription>
        <CreateOrgForm />
      </DialogContent>
    </Dialog>
  );
}
