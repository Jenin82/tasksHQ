"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CreateOrgForm } from "./create-org-form";

// The signed-in `/`'s one primary button. No close-on-success handling: a
// created org redirects into itself, which leaves this page.
export function NewOrgDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>New organization</Button>
      </DialogTrigger>
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
