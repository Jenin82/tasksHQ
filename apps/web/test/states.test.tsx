import { env } from "cloudflare:test";
import React from "react";
import { drizzle } from "drizzle-orm/d1";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";
import {
  addProjectMember,
  createOrg,
  createProject,
  createTask,
  removeProjectMember,
} from "@tasks/core/domain";
import { orgMember, user } from "@tasks/core/schema";

// Same seam as test/task-detail.test.tsx: the route layer reads the session
// through this module, and the pool gives no live request context.
const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => {
  const current = () => ({
    id: actor.id,
    name: actor.id,
    email: `${actor.id}@states.test`,
  });
  return { getUser: async () => current(), requireUser: async () => current() };
});

const AppError = (await import("@/app/error")).default;
const NotFound = (await import("@/app/not-found")).default;
const Forbidden = (await import("@/app/forbidden")).default;
const TaskDetailPage = (
  await import("@/app/[org]/[project]/[task]/page")
).default;

const db = drizzle(env.DB);
const now = new Date();

// Shared storage (§12: no per-test isolation), so every id and slug is `es-`.
const IDS = ["es-owner", "es-member"];
await db.insert(user).values(
  IDS.map((id) => ({
    id,
    name: id.toUpperCase(),
    email: `${id}@states.test`,
    createdAt: now,
    updatedAt: now,
  })),
);

const ownerCtx = { db, actorUserId: "es-owner", source: "web" as const };

actor.id = "es-owner";
const acme = await createOrg(ownerCtx, { slug: "es-acme", name: "ES Acme" });
await db.insert(orgMember).values({
  orgId: acme.id,
  userId: "es-member",
  role: "member",
  createdAt: now,
});

// ---------------------------------------------------------------------------
// the error boundary
// ---------------------------------------------------------------------------

/**
 * What the framework puts around a segment: `app/error.tsx` is the fallback,
 * not the boundary itself, so the test supplies the boundary.
 *
 * **React's server renderer never consults a class error boundary.** Verified
 * two ways while writing this: `renderToStaticMarkup` rethrows, and
 * `renderToReadableStream` emits `Switched to client rendering because the
 * server rendering errored` at the nearest `Suspense` and renders *its*
 * fallback. Recovery is a client-side mechanism, and the pool has no DOM to
 * run it in — so what is pinned here is the half that is ours: given the error
 * React hands it, the fallback renders a way back and leaks nothing.
 */
class Boundary extends React.Component<
  { children: React.ReactNode },
  { error: (Error & { digest?: string }) | null }
> {
  state: { error: (Error & { digest?: string }) | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <AppError error={this.state.error} reset={() => {}} />
    ) : (
      this.props.children
    );
  }
}

function thrown() {
  const error: Error & { digest?: string } = new Error(
    "select * from secrets failed",
  );
  error.digest = "3117862285";
  return error;
}

it("the error fallback offers a way back and never the thrown message", () => {
  const boundary = new Boundary({ children: null });
  // The state React would put it in, through the same static it would call.
  boundary.state = Boundary.getDerivedStateFromError(thrown());

  const html = renderToStaticMarkup(boundary.render() as React.ReactElement);

  // `reset` is the only way out of this page, so it has to be a control.
  expect(html).toContain("<button");
  // The digest is the handle on the matching server-log line.
  expect(html).toContain("3117862285");
  // A server stack or a SQL fragment is not the reader's business, and in
  // production React replaces the message with the digest anyway.
  expect(html).not.toContain("select * from secrets failed");
});

// ---------------------------------------------------------------------------
// 403 and 404
// ---------------------------------------------------------------------------

it("403 and 404 are two different pages, not one shared one", () => {
  const notFound = renderToStaticMarkup(<NotFound />);
  const forbidden = renderToStaticMarkup(<Forbidden />);

  expect(notFound).toContain("404");
  expect(notFound).not.toContain("403");
  expect(forbidden).toContain("403");
  expect(forbidden).not.toContain("404");
  expect(notFound).not.toBe(forbidden);
});

// ---------------------------------------------------------------------------
// an assignee who no longer reaches the project
// ---------------------------------------------------------------------------

it("keeps an organization member assignable when their project role row is removed", async () => {
  const project = await createProject(ownerCtx, {
    orgId: acme.id,
    slug: "detached",
    name: "Detached",
    key: "ESD",
  });
  await addProjectMember(ownerCtx, {
    projectId: project.id,
    userId: "es-member",
  });

  const created = await createTask(ownerCtx, {
    projectId: project.id,
    title: "Assigned to an organization member",
    assigneeUserId: "es-member",
  });

  await removeProjectMember(ownerCtx, {
    projectId: project.id,
    userId: "es-member",
  });

  actor.id = "es-owner";
  const html = renderToStaticMarkup(
    await TaskDetailPage({
      params: Promise.resolve({
        org: "es-acme",
        project: "detached",
        task: created.key,
      }),
    }),
  );

  const pickerButtons = html.match(/<button\b[^>]*\baria-labelledby="[^"]+"[^>]*>[\s\S]*?<\/button>/g) ?? [];
  expect(pickerButtons.some((button) => button.includes(">Assignee</span>") && button.includes(">ES-MEMBER</span>"))).toBe(true);
  expect(html).not.toContain("No longer on this");
});
