"use client";

import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateSlackIntegrationAction, type SlackActionState } from "./slack-actions";

const slackWebhookGuide = "https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/#getting-started-with-incoming-webhooks";
const initialState: SlackActionState = {};

export function SlackIntegration({
  orgSlug,
  projectSlug,
  connected,
  lastError,
}: {
  orgSlug: string;
  projectSlug: string;
  connected: boolean;
  lastError: string | null;
}) {
  const webhookId = useId();
  const [state, submit, pending] = useActionState(
    updateSlackIntegrationAction.bind(null, orgSlug, projectSlug),
    initialState,
  );

  return (
    <section className="mt-8 rounded-2xl bg-card p-6 shadow-subtle">
      <h2 className="text-xl">Integrations</h2>
      <div className="mt-4 border-t border-border pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-medium">Slack</h3>
          <span className="text-xs text-muted-foreground">{connected ? "Webhook saved" : "Disconnected"}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Post to Slack when a work item is created or changes status.
        </p>

        <form action={submit} className="mt-4 space-y-1">
          <input type="hidden" name="operation" value="save" />
          <div className="flex items-center gap-2">
            <Label htmlFor={webhookId}>Webhook URL</Label>
            <Button variant="outline" size="icon-xs" asChild>
              <a
                href={slackWebhookGuide}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="How to get a Slack webhook URL (opens in a new tab)"
                title="How to get a Slack webhook URL"
              >
                ?
              </a>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={webhookId}
              name="webhook"
              type="password"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste a Slack webhook URL"
              maxLength={512}
              disabled={pending}
              required
              className="min-w-0 flex-1 basis-52"
            />
            <Button type="submit" variant="outline" size="sm" disabled={pending}>
              {connected ? "Replace webhook" : "Connect Slack"}
            </Button>
          </div>
        </form>

        {connected && (
          <form action={submit} className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" name="operation" value="test" variant="outline" size="sm" disabled={pending}>
              Send test message
            </Button>
            <Button type="submit" name="operation" value="disconnect" variant="ghost" size="sm" disabled={pending}>
              Disconnect
            </Button>
          </form>
        )}
        {lastError && <p className="mt-3 text-sm text-destructive">{lastError}</p>}
        {state.error && <p role="alert" className="mt-3 text-sm text-destructive">{state.error}</p>}
        {state.notice && <p role="status" className="mt-3 text-sm text-muted-foreground">{state.notice}</p>}
      </div>
    </section>
  );
}
