"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createTaskShareLink } from "./share-task-action";

export function ShareTaskButton({
  orgSlug,
  projectSlug,
  taskKey,
}: Parameters<typeof createTaskShareLink>[0]) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [fallbackLink, setFallbackLink] = useState("");

  async function copyLink() {
    setPending(true);
    setStatus("");
    setFallbackLink("");
    try {
      const result = await createTaskShareLink({ orgSlug, projectSlug, taskKey });
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      const url = new URL(result.path, window.location.origin).href;
      try {
        await navigator.clipboard.writeText(url);
        setStatus("Link copied.");
      } catch {
        setFallbackLink(url);
        setStatus("Copy the selected link.");
      }
    } catch {
      setStatus("Couldn’t create a share link. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button type="button" variant="outline" size="sm" onClick={copyLink} disabled={pending}>
        <Share2 aria-hidden />
        {pending ? "Sharing…" : "Share"}
      </Button>
      <span role="status" className="text-xs text-muted-foreground empty:sr-only">{status}</span>
      {fallbackLink && (
        <Input
          aria-label="Work item share link"
          value={fallbackLink}
          readOnly
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          className="w-56 max-w-full"
        />
      )}
    </div>
  );
}
