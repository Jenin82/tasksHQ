import { Buffer } from "node:buffer";
import { and, asc, eq, exists, gt, lt, lte, notExists } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { alias } from "drizzle-orm/sqlite-core";
import { DomainError } from "@tasks/core/errors";
import { org, project, projectSlack, slackOutbox, type SlackEvent } from "@tasks/core/schema";

const encoder = new TextEncoder();
const MAX_ATTEMPTS = 5;
const LEASE_MS = 120_000;
const MAX_RETRY_MS = 86_400_000;
const REQUEST_TIMEOUT_MS = 10_000;

function webhookUrl(raw: string) {
  const url = raw.trim();
  if (url.length > 512 || !/^https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9_-]+$/.test(url)) {
    throw new DomainError("Enter an incoming webhook URL from Slack.");
  }
  return url;
}

async function webhookKey(secret: string, projectId: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({
    name: "HKDF", hash: "SHA-256", salt: encoder.encode("tasks/slack/v1"), info: encoder.encode(projectId),
  }, key, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptSlackWebhook(secret: string, projectId: string, rawUrl: string) {
  const url = webhookUrl(rawUrl);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await webhookKey(secret, projectId);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(url));
  return `v1.${Buffer.from(iv).toString("base64url")}.${Buffer.from(ciphertext).toString("base64url")}`;
}

async function decryptWebhook(secret: string, projectId: string, encrypted: string) {
  const [version, iv, ciphertext, extra] = encrypted.split(".");
  if (version !== "v1" || !iv || !ciphertext || extra !== undefined) throw new Error("Invalid webhook encoding.");
  const key = await webhookKey(secret, projectId);
  const plaintext = await crypto.subtle.decrypt({
    name: "AES-GCM", iv: Uint8Array.from(Buffer.from(iv, "base64url")),
  }, key, Uint8Array.from(Buffer.from(ciphertext, "base64url")));
  return webhookUrl(new TextDecoder().decode(plaintext));
}

function slackMessage(event: SlackEvent, origin: string, orgSlug: string, projectSlug: string) {
  const options = { unfurl_links: false, unfurl_media: false, mrkdwn: false };
  if (event.type === "test") return { ...options, text: "TasksHQ is connected to this Slack channel." };

  const transition = event.type === "created"
    ? `${event.actor} created this work item in ${event.toStatus}.`
    : `${event.actor} moved it from ${event.fromStatus} to ${event.toStatus}.`;
  const summary = `${event.taskKey}  ${event.title}\n${transition}`;
  const href = new URL(`/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}/${encodeURIComponent(event.taskKey)}`, origin).href;
  return {
    ...options,
    text: summary.replace(/[&<>]/g, (char) => char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;"),
    blocks: [
      { type: "section", text: { type: "plain_text", text: summary, emoji: false } },
      { type: "context", elements: [{ type: "mrkdwn", text: `<${href}|Open in TasksHQ>` }] },
    ],
  };
}

type SlackFetch = (url: string, init: RequestInit) => Promise<Response>;
type Delivery = { error: string | null; retryMs?: number };

async function deliverWebhook(
  url: string,
  payload: ReturnType<typeof slackMessage>,
  request: SlackFetch,
): Promise<Delivery> {
  try {
    const response = await request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return { error: null };
    if (response.status === 429) {
      const seconds = Number(response.headers.get("Retry-After"));
      // Stop retrying if Slack asks us to wait beyond the retry horizon.
      return {
        error: "Slack rate-limited delivery.",
        retryMs: seconds * 1_000 > MAX_RETRY_MS ? undefined : Math.max(1_000, seconds * 1_000 || 60_000),
      };
    }
    if (response.status >= 500) return { error: "Slack is temporarily unavailable.", retryMs: 60_000 };
    return { error: `Slack rejected the request (HTTP ${response.status}). Check the webhook in Slack.` };
  } catch {
    // Fetch exceptions can include the secret URL. Only persist fixed copy.
    return { error: "TasksHQ could not reach Slack.", retryMs: 60_000 };
  }
}

export async function drainSlackOutbox(
  db: DrizzleD1Database,
  origin: string,
  secret: string,
  request: SlackFetch = fetch,
) {
  const now = Date.now();
  const earlier = alias(slackOutbox, "earlier_slack_event");
  const jobs = await db.select().from(slackOutbox).where(and(
    lte(slackOutbox.readyAt, now),
    notExists(db.select({ id: earlier.id }).from(earlier).where(and(
      eq(earlier.projectId, slackOutbox.projectId), eq(earlier.revision, slackOutbox.revision),
      lt(earlier.id, slackOutbox.id),
    ))),
  )).orderBy(asc(slackOutbox.id)).limit(20);

  async function deliver(job: typeof slackOutbox.$inferSelect) {
    const leaseId = crypto.randomUUID();
    const lease = and(eq(slackOutbox.id, job.id), eq(slackOutbox.leaseId, leaseId));
    const [claimed] = await db.update(slackOutbox)
      .set({ leaseId, readyAt: now + LEASE_MS, attempts: job.attempts + 1 })
      .where(and(eq(slackOutbox.id, job.id), lte(slackOutbox.readyAt, now)))
      .returning({ id: slackOutbox.id });
    if (!claimed) return;

    const current = await db.select({
      encryptedWebhook: projectSlack.encryptedWebhook, orgSlug: org.slug, projectSlug: project.slug,
    }).from(projectSlack)
      .innerJoin(project, eq(project.id, projectSlack.projectId))
      .innerJoin(org, eq(org.id, project.orgId))
      .where(and(eq(projectSlack.projectId, job.projectId), eq(projectSlack.revision, job.revision))).get();
    if (!current) {
      await db.delete(slackOutbox).where(lease);
      return;
    }

    let result: Delivery = { error: "Slack delivery could not be completed after several attempts." };
    if (job.attempts < MAX_ATTEMPTS) {
      const url = await decryptWebhook(secret, job.projectId, current.encryptedWebhook).catch(() => null);
      if (url) {
        const activeLease = await db.select({ id: slackOutbox.id }).from(slackOutbox)
          .innerJoin(projectSlack, and(
            eq(projectSlack.projectId, slackOutbox.projectId), eq(projectSlack.revision, slackOutbox.revision),
          )).where(and(lease, gt(slackOutbox.readyAt, Date.now() + REQUEST_TIMEOUT_MS))).get();
        if (!activeLease) return;
        result = await deliverWebhook(url, slackMessage(job.payload, origin, current.orgSlug, current.projectSlug), request);
      } else {
        result = { error: "TasksHQ could not read the webhook. Replace it in project settings." };
      }
    }

    if (result.retryMs !== undefined && job.attempts + 1 < MAX_ATTEMPTS) {
      await db.update(slackOutbox).set({
        leaseId: null,
        readyAt: Date.now() + Math.max(result.retryMs, 60_000 * 2 ** job.attempts),
      }).where(lease);
      return;
    }

    await db.batch([
      db.update(projectSlack).set({ lastError: result.error }).where(and(
        eq(projectSlack.projectId, job.projectId),
        eq(projectSlack.revision, job.revision),
        exists(db.select({ id: slackOutbox.id }).from(slackOutbox).where(lease)),
      )),
      db.delete(slackOutbox).where(lease),
    ]);
  }

  for (let start = 0; start < jobs.length; start += 4) {
    const results = await Promise.allSettled(jobs.slice(start, start + 4).map(deliver));
    if (results.some(({ status }) => status === "rejected")) {
      console.error("A Slack outbox job could not be processed.");
    }
  }
  return jobs.length;
}
