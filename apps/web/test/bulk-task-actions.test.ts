import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it, vi } from "vitest";
import {
  createOrg,
  createProject,
  createTask,
  getTaskDetail,
  setProjectMemberRole,
} from "@tasks/core/domain";
import { orgMember, status, user } from "@tasks/core/schema";

const actor = vi.hoisted(() => ({ id: "bulk-member" }));
vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: actor.id, name: actor.id, email: `${actor.id}@bulk.test` }),
}));

const { bulkUpdateTasksAction } = await import("@/app/[org]/[project]/[task]/actions");

it("scopes updates to each selected task and reports failures without dropping successful changes", async () => {
  const db = drizzle(env.DB);
  const now = new Date();
  const ownerId = "bulk-owner";
  await db.insert(user).values([ownerId, actor.id].map((id) => ({
    id, name: id, email: `${id}@bulk.test`, createdAt: now, updatedAt: now,
  })));
  const owner = { db, actorUserId: ownerId, source: "web" as const };
  const org = await createOrg(owner, { slug: "bulk-actions", name: "Bulk actions" });
  await db.insert(orgMember).values({
    orgId: org.id, userId: actor.id, role: "member", createdAt: now,
  });
  const outsideOrg = await createOrg(owner, { slug: "bulk-outside", name: "Outside" });
  const projects = await Promise.all([
    createProject(owner, { orgId: org.id, slug: "first", name: "First", key: "BLK" }),
    createProject(owner, { orgId: org.id, slug: "second", name: "Second", key: "SEC" }),
    createProject(owner, { orgId: outsideOrg.id, slug: "hidden", name: "Hidden", key: "HID" }),
  ]);
  const [first, second, hidden] = await Promise.all(projects.map(async (project) => {
    const item = await createTask(owner, { projectId: project.id, title: project.name });
    const [target] = await db.select().from(status).where(eq(status.projectId, project.id))
      .then((rows) => rows.filter((row) => row.id !== item.status.id));
    return { projectSlug: project.slug, taskId: item.id, initialStatus: item.status.id, target: target.id };
  }));

  const submit = (field: Parameters<typeof bulkUpdateTasksAction>[0]["field"], changes: {
    taskId: string; projectSlug: string; value: string;
  }[]) => bulkUpdateTasksAction({ orgSlug: org.slug, field, changes });
  const detail = (taskId: string) => getTaskDetail(owner, { taskId });
  await setProjectMemberRole(owner, { projectId: projects[0].id, userId: actor.id, role: "admin" });
  expect(await submit("priority", [
    { ...first, value: "high" },
    { ...second, value: "high" },
  ])).toEqual({
    updatedIds: [first.taskId],
    failures: [{ taskId: second.taskId, error: "Only administrators can bulk edit tasks in this project." }],
  });
  expect((await detail(first.taskId)).priority).toBe("high");
  expect((await detail(second.taskId)).priority).toBe("medium");

  expect(await submit("archive", [{ ...second, value: "" }])).toMatchObject({
    updatedIds: [], failures: [{ taskId: second.taskId, error: expect.stringMatching(/administrators/) }],
  });
  expect((await detail(second.taskId)).archivedAt).toBeNull();
  await setProjectMemberRole(owner, { projectId: projects[1].id, userId: actor.id, role: "admin" });

  const result = await submit("statusId", [
    { ...first, value: first.target },
    { ...second, value: first.target },
    { ...hidden, value: hidden.target },
  ]);
  expect(result.updatedIds).toEqual([first.taskId]);
  expect(result.failures).toEqual([
    { taskId: second.taskId, error: expect.stringMatching(/status/i) },
    { taskId: hidden.taskId, error: "This task is no longer available in that project." },
  ]);
  expect(await detail(first.taskId)).toMatchObject({
    status: { id: first.target },
    activity: expect.arrayContaining([expect.objectContaining({ type: "task.moved" })]),
  });
  expect((await detail(second.taskId)).status.id).toBe(second.initialStatus);
  expect((await detail(hidden.taskId)).status.id).toBe(hidden.initialStatus);

  expect(await submit("priority", [{ ...second, projectSlug: first.projectSlug, value: "high" }]))
    .toMatchObject({ updatedIds: [], failures: [{ taskId: second.taskId }] });
  expect(await submit("priority", Array.from({ length: 51 }, () => ({ ...first, value: "high" }))))
    .toMatchObject({ updatedIds: [], error: expect.stringMatching(/50 tasks/) });

  const toArchive = [first, second].map((row) => ({ ...row, value: "" }));
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(await submit("archive", toArchive)).toEqual({
      updatedIds: [first.taskId, second.taskId], failures: [],
    });
  }
  for (const { taskId } of toArchive) {
    const archived = await detail(taskId);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(archived.activity.filter((entry) => entry.type === "task.archived")).toHaveLength(1);
  }
  expect(await submit("priority", [{ ...first, value: "high" }]))
    .toMatchObject({ updatedIds: [], failures: [{ taskId: first.taskId, error: "This task is archived." }] });
});
