import { env } from "cloudflare:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";
import {
  addComment,
  addProjectMember,
  archiveTask,
  changeOrgMemberRole,
  createOrg,
  createProject,
  createTask,
  deleteArchivedTask,
  deleteOrg,
  deleteProject,
  getTaskDetail,
  inviteToOrg,
  listTasks,
  unarchiveTask,
} from "@tasks/core/domain";
import {
  activity,
  comment,
  org,
  orgInvite,
  orgMember,
  project,
  projectMember,
  status,
  task,
  user,
} from "@tasks/core/schema";
import { deleteOrgAction, renameOrgAction } from "@/app/[org]/(org)/settings/general/actions";
import OrganizationGeneralPage from "@/app/[org]/(org)/settings/general/page";
import MembersPage from "@/app/[org]/(org)/settings/members/page";
import { deleteProjectAction } from "@/app/[org]/[project]/settings/actions";
import ProjectSettingsPage from "@/app/[org]/[project]/settings/page";
import { archiveAction } from "@/app/[org]/[project]/[task]/actions";
import { deleteArchivedTaskAction } from "@/app/[org]/[project]/archived/actions";
import ArchivedPage from "@/app/[org]/[project]/archived/page";

const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => ({
  requireUser: async () => ({
    id: actor.id,
    name: actor.id,
    email: `${actor.id}@deletion.test`,
  }),
}));

const db = drizzle(env.DB);
const now = new Date();
const ownerId = "del-owner";
const adminId = "del-admin";
const memberId = "del-member";
const outsiderId = "del-outsider";
const ids = [ownerId, adminId, memberId, outsiderId];
await db.insert(user).values(
  ids.map((id) => ({
    id,
    name: id,
    email: `${id}@deletion.test`,
    createdAt: now,
    updatedAt: now,
  })),
);

function context(actorUserId = ownerId) {
  return { db, actorUserId, source: "web" as const };
}

function form(confirmation: string) {
  const data = new FormData();
  data.set("confirmation", confirmation);
  return data;
}

function redirectTo(path: string) {
  return {
    digest: expect.stringMatching(
      `^NEXT_REDIRECT;[^;]*;${encodeURIComponent(path)}(;|$)`,
    ),
  };
}

async function projectWithTasks(orgId: string, slug: string, key: string) {
  const row = await createProject(context(), { orgId, slug, key, name: slug });
  const live = await createTask(context(), { projectId: row.id, title: "Live" });
  const archived = await createTask(context(), {
    projectId: row.id,
    title: "Archived",
  });
  await archiveTask(context(), { taskId: archived.id });
  await addComment(context(), { taskId: archived.id, body: "A comment" });
  return { ...row, taskIds: [live.id, archived.id] };
}

async function projectContents(row: Awaited<ReturnType<typeof projectWithTasks>>) {
  const records = await db.batch([
    db.select().from(project).where(eq(project.id, row.id)),
    db.select().from(projectMember).where(eq(projectMember.projectId, row.id)),
    db.select().from(status).where(eq(status.projectId, row.id)),
    db.select().from(task).where(eq(task.projectId, row.id)),
    db.select().from(comment).where(inArray(comment.taskId, row.taskIds)),
    db.select().from(activity).where(eq(activity.projectId, row.id)),
  ]);
  return records.map((rows) => rows.length);
}

async function orgContents(orgId: string) {
  const records = await db.batch([
    db.select().from(org).where(eq(org.id, orgId)),
    db.select().from(orgMember).where(eq(orgMember.orgId, orgId)),
    db.select().from(orgInvite).where(eq(orgInvite.orgId, orgId)),
  ]);
  return records.map((rows) => rows.length);
}

it("shows deletion only to org owners and denies direct requests from other roles", async () => {
  const organization = await createOrg(context(), {
    slug: "del-permissions",
    name: "Permissions",
  });
  const target = await createProject(context(), {
    orgId: organization.id,
    slug: "del-restricted",
    name: "Restricted",
    key: "DRS",
  });
  await db.insert(orgMember).values([
    { orgId: organization.id, userId: adminId, role: "admin", createdAt: now },
    { orgId: organization.id, userId: memberId, role: "member", createdAt: now },
  ]);
  await addProjectMember(context(), { projectId: target.id, userId: memberId });

  const orgParams = { org: organization.slug };
  const forbidden = { digest: "NEXT_HTTP_ERROR_FALLBACK;403" };
  for (const actorId of [ownerId, adminId, memberId]) {
    actor.id = actorId;
    const general = OrganizationGeneralPage({ params: Promise.resolve(orgParams) });
    if (actorId === memberId) {
      await expect(general).rejects.toMatchObject(forbidden);
    } else {
      const orgHtml = renderToStaticMarkup(await general);
      expect(orgHtml).toContain("Organization name");
      expect(orgHtml.includes("Delete organization")).toBe(actorId === ownerId);
    }
    if (actorId === memberId) {
      await expect(MembersPage({ params: Promise.resolve(orgParams) })).rejects.toMatchObject(forbidden);
    } else {
      const membersHtml = renderToStaticMarkup(await MembersPage({ params: Promise.resolve(orgParams) }));
      expect(membersHtml).not.toContain("Delete organization");
    }
    const projectSettings = ProjectSettingsPage({
      params: Promise.resolve({ ...orgParams, project: target.slug }),
    });
    if (actorId === memberId) {
      await expect(projectSettings).rejects.toMatchObject(forbidden);
    } else {
      const projectHtml = renderToStaticMarkup(await projectSettings);
      expect(projectHtml.includes("Delete project")).toBe(actorId === ownerId);
    }
  }

  for (const actorId of [adminId, memberId, outsiderId]) {
    const reason = actorId === outsiderId ? "not_a_member" : "forbidden";
    await expect(
      deleteOrg(context(actorId), { orgId: organization.id, confirmation: organization.slug }),
    ).rejects.toMatchObject({ name: "AccessError", reason });
    await expect(
      deleteProject(context(actorId), { projectId: target.id, confirmation: target.slug }),
    ).rejects.toMatchObject({ name: "AccessError", reason });
  }

  actor.id = adminId;
  await expect(
    deleteOrgAction(organization.slug, organization.id, {}, form(organization.slug)),
  ).rejects.toMatchObject(forbidden);
  await expect(
    deleteProjectAction(organization.slug, target.slug, target.id, {}, form(target.slug)),
  ).rejects.toMatchObject(forbidden);
});

it("lets owners and admins rename an organization while preserving its slug", async () => {
  const organization = await createOrg(context(), { slug: "del-rename", name: "Before" });
  await db.insert(orgMember).values([
    { orgId: organization.id, userId: adminId, role: "admin", createdAt: now },
    { orgId: organization.id, userId: memberId, role: "member", createdAt: now },
  ]);
  const submit = (name: string) => {
    const data = new FormData();
    data.set("name", name);
    return renameOrgAction(organization.slug, organization.id, {}, data);
  };

  actor.id = memberId;
  await expect(submit("Forbidden")).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;403" });
  actor.id = outsiderId;
  await expect(submit("Hidden")).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  actor.id = ownerId;
  await expect(submit("  ")).resolves.toMatchObject({ error: "Organization name is required." });
  await expect(submit("Owner name")).resolves.toEqual({ values: { name: "Owner name" } });
  actor.id = adminId;
  await expect(submit("  Admin name  ")).resolves.toEqual({ values: { name: "Admin name" } });

  const [stored] = await db.select().from(org).where(eq(org.id, organization.id));
  expect(stored).toMatchObject({ name: "Admin name", slug: organization.slug });
});

it("deletes only the confirmed project and refuses a stale form after slug reuse", async () => {
  actor.id = ownerId;
  const organization = await createOrg(context(), {
    slug: "del-project-org",
    name: "Project deletion",
  });
  const target = await projectWithTasks(organization.id, "del-target", "DLT");
  const neighbor = await projectWithTasks(organization.id, "del-neighbor", "DLN");
  const targetBefore = await projectContents(target);
  const neighborBefore = await projectContents(neighbor);
  const submit = (confirmation: string) =>
    deleteProjectAction(organization.slug, target.slug, target.id, {}, form(confirmation));

  expect(await submit(`${target.slug} `)).toMatchObject({ error: expect.any(String) });
  expect(await projectContents(target)).toEqual(targetBefore);

  await expect(submit(target.slug)).rejects.toMatchObject(redirectTo(`/${organization.slug}`));
  expect(await projectContents(target)).toEqual([0, 0, 0, 0, 0, 0]);
  expect(await projectContents(neighbor)).toEqual(neighborBefore);
  expect(await orgContents(organization.id)).toEqual([1, 1, 0]);

  const replacement = await projectWithTasks(organization.id, target.slug, target.key);
  await expect(submit(target.slug)).rejects.toMatchObject({
    digest: "NEXT_HTTP_ERROR_FALLBACK;404",
  });
  expect(await projectContents(replacement)).toEqual(targetBefore);
});

it("deletes an organization's projects, memberships and invites while preserving other organizations and users", async () => {
  actor.id = ownerId;
  const organization = await createOrg(context(), {
    slug: "del-org-target",
    name: "Organization deletion",
  });
  const neighbor = await createOrg(context(), {
    slug: "del-org-neighbor",
    name: "Neighboring organization",
  });
  await db.insert(orgMember).values({
    orgId: organization.id,
    userId: memberId,
    role: "owner",
    createdAt: now,
  });
  for (const orgId of [organization.id, neighbor.id]) {
    await inviteToOrg(context(), { orgId, email: "pending@deletion.test", role: "member" });
  }
  const first = await projectWithTasks(organization.id, "del-first", "DLF");
  const second = await projectWithTasks(organization.id, "del-second", "DLS");
  const preserved = await projectWithTasks(neighbor.id, first.slug, first.key);
  const preservedBefore = await projectContents(preserved);
  const submit = (confirmation: string) =>
    deleteOrgAction(organization.slug, organization.id, {}, form(confirmation));

  expect(await submit("")).toMatchObject({ error: expect.any(String) });
  expect(await orgContents(organization.id)).toEqual([1, 2, 1]);

  await expect(submit(organization.slug)).rejects.toMatchObject(redirectTo("/"));
  expect(await orgContents(organization.id)).toEqual([0, 0, 0]);
  expect(await projectContents(first)).toEqual([0, 0, 0, 0, 0, 0]);
  expect(await projectContents(second)).toEqual([0, 0, 0, 0, 0, 0]);
  expect(await orgContents(neighbor.id)).toEqual([1, 1, 1]);
  expect(await projectContents(preserved)).toEqual(preservedBefore);
  expect(await db.select().from(user).where(inArray(user.id, ids))).toHaveLength(ids.length);

  const replacement = await createOrg(context(), {
    slug: organization.slug,
    name: "Replacement",
  });
  await expect(submit(organization.slug)).rejects.toMatchObject({
    digest: "NEXT_HTTP_ERROR_FALLBACK;404",
  });
  expect(await orgContents(replacement.id)).toEqual([1, 1, 0]);
});

it("rolls back project cleanup if the final delete fails", async () => {
  const organization = await createOrg(context(), {
    slug: "del-rollback",
    name: "Rollback",
  });
  const target = await projectWithTasks(organization.id, "del-atomic", "DLA");
  const before = await projectContents(target);
  await env.DB.exec(
    `CREATE TRIGGER del_test_abort BEFORE DELETE ON project WHEN OLD.id = '${target.id}' BEGIN SELECT RAISE(ABORT, 'del_test_abort'); END;`,
  );
  try {
    await expect(
      deleteProject(context(), { projectId: target.id, confirmation: target.slug }),
    ).rejects.toThrow();
    expect(await projectContents(target)).toEqual(before);
  } finally {
    await env.DB.exec("DROP TRIGGER del_test_abort;");
  }
});

it.each(["project", "organization"] as const)(
  "preserves %s data if the actor loses ownership before the delete batch",
  async (kind) => {
    const organization = await createOrg(context(), {
      slug: `del-demoted-${kind}`,
      name: "Demotion during deletion",
    });
    await db.insert(orgMember).values({
      orgId: organization.id,
      userId: memberId,
      role: "owner",
      createdAt: now,
    });
    await inviteToOrg(context(), {
      orgId: organization.id,
      email: "demoted@deletion.test",
      role: "member",
    });
    const target = await projectWithTasks(organization.id, "del-race", "DLR");
    const before = await projectContents(target);

    const racingDb = drizzle(env.DB);
    const batch = racingDb.batch.bind(racingDb);
    const intercepted = vi.spyOn(racingDb, "batch").mockImplementation(async (queries) => {
      await changeOrgMemberRole(context(memberId), {
        orgId: organization.id,
        userId: ownerId,
        role: "admin",
      });
      return batch(queries);
    });
    const ctx = { ...context(), db: racingDb };
    const deletion = kind === "project"
      ? deleteProject(ctx, { projectId: target.id, confirmation: target.slug })
      : deleteOrg(ctx, { orgId: organization.id, confirmation: organization.slug });

    await expect(deletion).rejects.toMatchObject({
      name: "AccessError",
      reason: "forbidden",
    });
    expect(intercepted).toHaveBeenCalledTimes(1);
    expect(await projectContents(target)).toEqual(before);
    expect(await orgContents(organization.id)).toEqual([1, 2, 1]);
  },
);

it("lists only archived tasks and lets a member restore them without granting permanent deletion", async () => {
  const organization = await createOrg(context(), { slug: "del-archive-view", name: "Archive view" });
  const target = await projectWithTasks(organization.id, "del-archive-list", "DAV");
  const [liveId, archivedId] = target.taskIds;
  await db.insert(orgMember).values([
    { orgId: organization.id, userId: adminId, role: "admin", createdAt: now },
    { orgId: organization.id, userId: memberId, role: "member", createdAt: now },
  ]);
  await addProjectMember(context(), { projectId: target.id, userId: memberId });

  const params = Promise.resolve({ org: organization.slug, project: target.slug });
  for (const actorId of [ownerId, adminId, memberId]) {
    actor.id = actorId;
    const html = renderToStaticMarkup(await ArchivedPage({ params }));
    expect(html).toContain("DAV-2");
    expect(html).not.toContain("DAV-1");
    expect(html).toContain("Unarchive");
    expect(html.includes("Delete permanently")).toBe(actorId !== memberId);
  }

  actor.id = outsiderId;
  await expect(ArchivedPage({ params })).rejects.toMatchObject({
    digest: "NEXT_HTTP_ERROR_FALLBACK;404",
  });

  actor.id = memberId;
  await expect(deleteArchivedTaskAction(organization.slug, target.slug, archivedId, {}, form("DAV-2")))
    .rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;403" });

  const query = { projectId: target.id };
  const member = context(memberId);
  expect((await listTasks(member, query)).map(({ id }) => id)).toEqual([liveId]);
  expect((await listTasks(member, { ...query, archivedOnly: true })).map(({ id }) => id))
    .toEqual([archivedId]);
  expect(new Set((await listTasks(member, { ...query, includeArchived: true })).map(({ id }) => id)))
    .toEqual(new Set([liveId, archivedId]));

  const restore = new FormData();
  restore.set("org", organization.slug);
  restore.set("project", target.slug);
  restore.set("taskId", archivedId);
  restore.set("intent", "unarchive");
  expect(await archiveAction({}, restore)).toEqual({});
  expect(await listTasks(member, { ...query, archivedOnly: true })).toEqual([]);
  expect(new Set((await listTasks(member, query)).map(({ id }) => id)))
    .toEqual(new Set([liveId, archivedId]));
});

it("deletes an archived task and its history only within the confirmed project", async () => {
  const organization = await createOrg(context(), { slug: "del-archive-scope", name: "Archive scope" });
  await db.insert(orgMember).values({
    orgId: organization.id, userId: adminId, role: "admin", createdAt: now,
  });
  const target = await projectWithTasks(organization.id, "del-archive-target", "DAT");
  const neighbor = await projectWithTasks(organization.id, "del-archive-neighbor", "DAN");
  const [liveId, archivedId] = target.taskIds;
  const before = await projectContents(target);
  const neighborBefore = await projectContents(neighbor);
  const input = { projectId: target.id, taskId: archivedId, confirmation: "DAT-2" };

  await expect(deleteArchivedTask(context(adminId), { ...input, taskId: liveId, confirmation: "DAT-1" }))
    .rejects.toThrow(/archive this task/i);
  await expect(deleteArchivedTask(context(adminId), { ...input, confirmation: "DAT-2 " }))
    .rejects.toThrow(/confirm deletion/i);
  await expect(deleteArchivedTask(context(adminId), { ...input, projectId: neighbor.id }))
    .rejects.toMatchObject({ reason: "not_a_member" });
  expect(await projectContents(target)).toEqual(before);

  actor.id = adminId;
  expect(await deleteArchivedTaskAction(organization.slug, target.slug, archivedId, {}, form("DAT-2")))
    .toEqual({});
  await expect(getTaskDetail(context(), { taskId: archivedId })).rejects.toMatchObject({ reason: "not_a_member" });
  expect(await db.select().from(comment).where(eq(comment.taskId, archivedId))).toEqual([]);
  expect(await db.select().from(activity).where(eq(activity.taskId, archivedId))).toEqual([]);
  expect((await getTaskDetail(context(), { taskId: liveId })).activity).toHaveLength(1);
  expect(await projectContents(neighbor)).toEqual(neighborBefore);

  await deleteArchivedTask(context(), { projectId: neighbor.id, taskId: neighbor.taskIds[1], confirmation: "DAN-2" });
  expect(await listTasks(context(), { projectId: neighbor.id, archivedOnly: true })).toEqual([]);
});

it.each(["restore", "demotion"] as const)(
  "preserves the task and its history when a %s wins the race with deletion",
  async (race) => {
    const organization = await createOrg(context(), { slug: `del-archive-${race}`, name: "Archive race" });
    const target = await projectWithTasks(organization.id, "del-archive-race", "DAR");
    await db.insert(orgMember).values({
      orgId: organization.id, userId: adminId, role: "admin", createdAt: now,
    });
    await addProjectMember(context(), { projectId: target.id, userId: adminId });
    const taskId = target.taskIds[1];
    const before = await getTaskDetail(context(), { taskId });

    const racingDb = drizzle(env.DB);
    const batch = racingDb.batch.bind(racingDb);
    const intercepted = vi.spyOn(racingDb, "batch").mockImplementation(async (queries) => {
      if (race === "restore") {
        await unarchiveTask(context(), { taskId });
      } else {
        await changeOrgMemberRole(context(), {
          orgId: organization.id, userId: adminId, role: "member",
        });
      }
      return batch(queries);
    });
    const deletion = deleteArchivedTask({ ...context(adminId), db: racingDb }, {
      projectId: target.id,
      taskId,
      confirmation: "DAR-2",
    });
    if (race === "restore") {
      await expect(deletion).rejects.toThrow(/no longer available/i);
    } else {
      await expect(deletion).rejects.toMatchObject({ reason: "forbidden" });
    }
    expect(intercepted).toHaveBeenCalledTimes(1);

    const after = await getTaskDetail(context(), { taskId });
    expect(after.archivedAt).toEqual(race === "restore" ? null : before.archivedAt);
    expect(after.comments).toEqual(before.comments);
    expect(after.activity.map(({ type }) => type)).toEqual([
      ...before.activity.map(({ type }) => type),
      ...(race === "restore" ? ["task.unarchived"] : []),
    ]);
  },
);
