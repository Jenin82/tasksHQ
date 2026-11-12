"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { ProfileAvatar } from "@/components/profile-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { AccountUser } from "@/components/account-menu";

export function ProfilePhotoDialog({ user, open, onOpenChange, restoreFocus }: {
  user: AccountUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocus: () => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <DialogContent closeDisabled={pending} onCloseAutoFocus={(event) => {
        event.preventDefault();
        restoreFocus();
      }}>
        <DialogTitle>Account settings</DialogTitle>
        <DialogDescription>Your profile photo appears beside your name in TasksHQ.</DialogDescription>
        <ProfilePhotoForm user={user} pending={pending} setPending={setPending} />
      </DialogContent>
    </Dialog>
  );
}

function ProfilePhotoForm({ user, pending, setPending }: {
  user: AccountUser;
  pending: boolean;
  setPending: (pending: boolean) => void;
}) {
  const router = useRouter();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState(user.image ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function changePhoto(photo: File | null) {
    setPending(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/profile/avatar", photo ? { method: "POST", body: photo } : { method: "DELETE" });
      const data = await response.json<{ error?: string; image?: string | null }>();
      if (!response.ok || data.image === undefined) {
        setError(data.error || "Couldn’t change your profile photo. Try again.");
        return;
      }
      setImage(data.image);
      setFile(null);
      if (input.current) input.current.value = "";
      setNotice(photo ? "Profile photo updated." : "Profile photo removed.");
      router.refresh();
    } catch {
      setError("Couldn’t change your profile photo. Try again.");
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (file && !pending) void changePhoto(file);
  }

  return (
    <form className="mt-5 space-y-4" onSubmit={submit} aria-busy={pending}>
      <div className="flex items-center gap-3">
        <ProfileAvatar name={user.name} image={image} className="size-12 bg-muted text-sm" />
        <div className="min-w-0 text-sm">
          <p className="truncate">{user.name}</p>
          <p className="truncate text-foreground/60">{user.email}</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={inputId} className="text-sm">Profile photo</label>
        <Input
          id={inputId}
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          disabled={pending}
          aria-describedby={`${inputId}-hint`}
          onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
        />
        <p id={`${inputId}-hint`} className="text-xs text-foreground/60">PNG, JPEG, WebP, GIF, or AVIF up to 5 MB.</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!file || pending}>{pending ? "Saving…" : "Save photo"}</Button>
        {image && <Button type="button" variant="outline" disabled={pending} onClick={() => void changePhoto(null)}>Remove photo</Button>}
      </div>
    </form>
  );
}
