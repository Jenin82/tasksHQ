import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";
import {
  createTeam,
  createProject,
  createTask,
} from "@tasks/core/domain";
import { teamMember, task, user } from "@tasks/core/schema";
import { listAssignmentCreateProjects } from "@/app/[team]/(team)/settings/assignment-create-projects";
import { WorkspaceAssignmentPage } from "@/app/[team]/(team)/settings/workspace-assignment-page";

const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  usePathname: () => "/all-tasks-alpha/settings/all-tasks",
}));
vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: actor.id, name: actor.id, email: `${actor.id}@all-tasks.test` }),
}));

const db = drizzle(env.DB);

it("combines reachable assignments and preserves links when project slugs and keys repeat", async () => {
  const ownerId = "all-tasks-owner";
  const memberId = "all-tasks-member";
  const now = new Date();
  await db.insert(user).values([ownerId, memberId].map((id) => ({
    id, name: id, email: `${id}@all-tasks.test`, createdAt: now, updatedAt: now,
  })));

  const owner = { db, actorUserId: ownerId, source: "web" as const };
  const alpha = await createTeam(owner, { name: "All Tasks Alpha", slug: "all-tasks-alpha" });
  const beta = await createTeam(owner, { name: "All Tasks Beta", slug: "all-tasks-beta" });
  const outside = await createTeam(owner, { name: "All Tasks Outside", slug: "all-tasks-outside" });
  await db.insert(teamMember).values([alpha.id, beta.id].map((teamId) => ({
    teamId, userId: memberId, role: "member" as const, createdAt: now,
  })));

  const makeProject = (teamId: string, slug = "shared", key = "ALL") =>
    createProject(owner, { teamId, name: slug, slug, key });
  const [alphaProject, betaProject, outsideProject, anotherProject] = await Promise.all([
    makeProject(alpha.id), makeProject(beta.id), makeProject(outside.id),
    makeProject(alpha.id, "another", "ANT"),
  ]);

  const [alphaTask, betaTask] = await Promise.all([
    createTask(owner, { projectId: alphaProject.id, assigneeUserId: memberId, title: "Alpha visible task" }),
    createTask(owner, { projectId: betaProject.id, assigneeUserId: memberId, title: "Beta visible task" }),
  ]);
  await createTask(owner, { projectId: anotherProject.id, assigneeUserId: memberId, title: "Another project in Alpha" });
  const outsideTask = await createTask(owner, { projectId: outsideProject.id, title: "Outside membership" });
  // A stale assignment never confers visibility in a team.
  await db.update(task).set({ assigneeUserId: memberId }).where(eq(task.id, outsideTask.id));

  actor.id = memberId;
  expect(await listAssignmentCreateProjects([alpha, beta], memberId)).toEqual([
    { slug: alpha.slug, name: alpha.name, projects: [
      { slug: "another", name: "another", key: "ANT" },
      { slug: "shared", name: "shared", key: "ALL" },
    ] },
    { slug: beta.slug, name: beta.name, projects: [{ slug: "shared", name: "shared", key: "ALL" }] },
  ]);
  const html = renderToStaticMarkup(await WorkspaceAssignmentPage({
    teamSlug: alpha.slug, view: "mine", allTeams: true,
  }));

  expect(html).toContain("All My Tasks");
  expect(html).toContain("Team");
  expect(html).toContain("Alpha visible task");
  expect(html).toContain("Beta visible task");
  expect(html).toContain(`href="/${alpha.slug}/shared/${alphaTask.key}"`);
  expect(html).toContain(`href="/${beta.slug}/shared/${betaTask.key}"`);
  expect(html).toContain("Another project in Alpha");
  expect(html).not.toContain("Outside membership");

  const local = renderToStaticMarkup(await WorkspaceAssignmentPage({ teamSlug: alpha.slug, view: "mine" }));
  expect(local).toContain("Alpha visible task");
  expect(local).not.toContain("Beta visible task");

  const member = { ...owner, actorUserId: memberId };
  await Promise.all([
    createTask(member, { projectId: alphaProject.id, assigneeUserId: ownerId, title: "Alpha assigned by me" }),
    createTask(member, { projectId: betaProject.id, assigneeUserId: ownerId, title: "Beta assigned by me" }),
  ]);
  const assigned = renderToStaticMarkup(await WorkspaceAssignmentPage({
    teamSlug: beta.slug, view: "assigned", allTeams: true,
  }));
  expect(assigned).toContain("Alpha assigned by me");
  expect(assigned).toContain("Beta assigned by me");
  expect(assigned).not.toContain("Beta visible task");

  await db.delete(teamMember).where(and(eq(teamMember.teamId, beta.id), eq(teamMember.userId, memberId)));
  await expect(WorkspaceAssignmentPage({
    teamSlug: alpha.slug, view: "mine", allTeams: true,
  })).rejects.toMatchObject({
    digest: expect.stringContaining(encodeURIComponent("/all-tasks-alpha/settings/your-tasks")),
  });
});
