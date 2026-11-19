import { env } from "cloudflare:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";
import {
  addComment,
  addProjectMember,
  archiveTask,
  changeTeamMemberRole,
  createTeam,
  createProject,
  createTask,
  deleteArchivedTask,
  deleteTeam,
  deleteProject,
  getTaskDetail,
  inviteToTeam,
  listTasks,
  unarchiveTask,
} from "@tasks/core/domain";
import {
  activity,
  comment,
  team as teamTable,
  teamInvite,
  teamMember,
  project,
  projectMember,
  status,
  task,
  user,
} from "@tasks/core/schema";
import { deleteTeamAction, renameTeamAction } from "@/app/[team]/(team)/settings/general/actions";
import TeamGeneralPage from "@/app/[team]/(team)/settings/general/page";
import MembersPage from "@/app/[team]/(team)/settings/members/page";
import { deleteProjectAction } from "@/app/[team]/[project]/settings/actions";
import ProjectSettingsPage from "@/app/[team]/[project]/settings/page";
import { archiveAction } from "@/app/[team]/[project]/[task]/actions";
import { deleteArchivedTaskAction } from "@/app/[team]/[project]/archived/actions";
import ArchivedPage from "@/app/[team]/[project]/archived/page";

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

async function projectWithTasks(teamId: string, slug: string, key: string) {
  const row = await createProject(context(), { teamId, slug, key, name: slug });
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

async function teamContents(teamId: string) {
  const records = await db.batch([
    db.select().from(teamTable).where(eq(teamTable.id, teamId)),
    db.select().from(teamMember).where(eq(teamMember.teamId, teamId)),
    db.select().from(teamInvite).where(eq(teamInvite.teamId, teamId)),
  ]);
  return records.map((rows) => rows.length);
}

it("shows deletion only to team owners and denies direct requests from other roles", async () => {
  const team = await createTeam(context(), {
    slug: "del-permissions",
    name: "Permissions",
  });
  const target = await createProject(context(), {
    teamId: team.id,
    slug: "del-restricted",
    name: "Restricted",
    key: "DRS",
  });
  await db.insert(teamMember).values([
    { teamId: team.id, userId: adminId, role: "admin", createdAt: now },
    { teamId: team.id, userId: memberId, role: "member", createdAt: now },
  ]);
  await addProjectMember(context(), { projectId: target.id, userId: memberId });

  const teamParams = { team: team.slug };
  const forbidden = { digest: "NEXT_HTTP_ERROR_FALLBACK;403" };
  for (const actorId of [ownerId, adminId, memberId]) {
    actor.id = actorId;
    const general = TeamGeneralPage({ params: Promise.resolve(teamParams) });
    if (actorId === memberId) {
      await expect(general).rejects.toMatchObject(forbidden);
    } else {
      const teamHtml = renderToStaticMarkup(await general);
      expect(teamHtml).toContain("Team name");
      expect(teamHtml.includes("Delete team")).toBe(actorId === ownerId);
    }
    if (actorId === memberId) {
      await expect(MembersPage({ params: Promise.resolve(teamParams) })).rejects.toMatchObject(forbidden);
    } else {
      const membersHtml = renderToStaticMarkup(await MembersPage({ params: Promise.resolve(teamParams) }));
      expect(membersHtml).not.toContain("Delete team");
    }
    const projectSettings = ProjectSettingsPage({
      params: Promise.resolve({ ...teamParams, project: target.slug }),
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
      deleteTeam(context(actorId), { teamId: team.id, confirmation: team.slug }),
    ).rejects.toMatchObject({ name: "AccessError", reason });
    await expect(
      deleteProject(context(actorId), { projectId: target.id, confirmation: target.slug }),
    ).rejects.toMatchObject({ name: "AccessError", reason });
  }

  actor.id = adminId;
  await expect(
    deleteTeamAction(team.slug, team.id, {}, form(team.slug)),
  ).rejects.toMatchObject(forbidden);
  await expect(
    deleteProjectAction(team.slug, target.slug, target.id, {}, form(target.slug)),
  ).rejects.toMatchObject(forbidden);
});

it("lets owners and admins rename a team while preserving its slug", async () => {
  const team = await createTeam(context(), { slug: "del-rename", name: "Before" });
  await db.insert(teamMember).values([
    { teamId: team.id, userId: adminId, role: "admin", createdAt: now },
    { teamId: team.id, userId: memberId, role: "member", createdAt: now },
  ]);
  const submit = (name: string) => {
    const data = new FormData();
    data.set("name", name);
    return renameTeamAction(team.slug, team.id, {}, data);
  };

  actor.id = memberId;
  await expect(submit("Forbidden")).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;403" });
  actor.id = outsiderId;
  await expect(submit("Hidden")).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  actor.id = ownerId;
  await expect(submit("  ")).resolves.toMatchObject({ error: "Team name is required." });
  await expect(submit("Owner name")).resolves.toEqual({ values: { name: "Owner name" } });
  actor.id = adminId;
  await expect(submit("  Admin name  ")).resolves.toEqual({ values: { name: "Admin name" } });

  const [stored] = await db.select().from(teamTable).where(eq(teamTable.id, team.id));
  expect(stored).toMatchObject({ name: "Admin name", slug: team.slug });
});

it("deletes only the confirmed project and refuses a stale form after slug reuse", async () => {
  actor.id = ownerId;
  const team = await createTeam(context(), {
    slug: "del-project-team",
    name: "Project deletion",
  });
  const target = await projectWithTasks(team.id, "del-target", "DLT");
  const neighbor = await projectWithTasks(team.id, "del-neighbor", "DLN");
  const targetBefore = await projectContents(target);
  const neighborBefore = await projectContents(neighbor);
  const submit = (confirmation: string) =>
    deleteProjectAction(team.slug, target.slug, target.id, {}, form(confirmation));

  expect(await submit(`${target.slug} `)).toMatchObject({ error: expect.any(String) });
  expect(await projectContents(target)).toEqual(targetBefore);

  await expect(submit(target.slug)).rejects.toMatchObject(redirectTo(`/${team.slug}`));
  expect(await projectContents(target)).toEqual([0, 0, 0, 0, 0, 0]);
  expect(await projectContents(neighbor)).toEqual(neighborBefore);
  expect(await teamContents(team.id)).toEqual([1, 1, 0]);

  const replacement = await projectWithTasks(team.id, target.slug, target.key);
  await expect(submit(target.slug)).rejects.toMatchObject({
    digest: "NEXT_HTTP_ERROR_FALLBACK;404",
  });
  expect(await projectContents(replacement)).toEqual(targetBefore);
});

it("deletes a team's projects, memberships and invites while preserving other teams and users", async () => {
  actor.id = ownerId;
  const team = await createTeam(context(), {
    slug: "del-team-target",
    name: "Team deletion",
  });
  const neighbor = await createTeam(context(), {
    slug: "del-team-neighbor",
    name: "Neighboring team",
  });
  await db.insert(teamMember).values({
    teamId: team.id,
    userId: memberId,
    role: "owner",
    createdAt: now,
  });
  for (const teamId of [team.id, neighbor.id]) {
    await inviteToTeam(context(), { teamId, email: "pending@deletion.test", role: "member" });
  }
  const first = await projectWithTasks(team.id, "del-first", "DLF");
  const second = await projectWithTasks(team.id, "del-second", "DLS");
  const preserved = await projectWithTasks(neighbor.id, first.slug, first.key);
  const preservedBefore = await projectContents(preserved);
  const submit = (confirmation: string) =>
    deleteTeamAction(team.slug, team.id, {}, form(confirmation));

  expect(await submit("")).toMatchObject({ error: expect.any(String) });
  expect(await teamContents(team.id)).toEqual([1, 2, 1]);

  await expect(submit(team.slug)).rejects.toMatchObject(redirectTo("/"));
  expect(await teamContents(team.id)).toEqual([0, 0, 0]);
  expect(await projectContents(first)).toEqual([0, 0, 0, 0, 0, 0]);
  expect(await projectContents(second)).toEqual([0, 0, 0, 0, 0, 0]);
  expect(await teamContents(neighbor.id)).toEqual([1, 1, 1]);
  expect(await projectContents(preserved)).toEqual(preservedBefore);
  expect(await db.select().from(user).where(inArray(user.id, ids))).toHaveLength(ids.length);

  const replacement = await createTeam(context(), {
    slug: team.slug,
    name: "Replacement",
  });
  await expect(submit(team.slug)).rejects.toMatchObject({
    digest: "NEXT_HTTP_ERROR_FALLBACK;404",
  });
  expect(await teamContents(replacement.id)).toEqual([1, 1, 0]);
});

it("rolls back project cleanup if the final delete fails", async () => {
  const team = await createTeam(context(), {
    slug: "del-rollback",
    name: "Rollback",
  });
  const target = await projectWithTasks(team.id, "del-atomic", "DLA");
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

it.each(["project", "team"] as const)(
  "preserves %s data if the actor loses ownership before the delete batch",
  async (kind) => {
    const team = await createTeam(context(), {
      slug: `del-demoted-${kind}`,
      name: "Demotion during deletion",
    });
    await db.insert(teamMember).values({
      teamId: team.id,
      userId: memberId,
      role: "owner",
      createdAt: now,
    });
    await inviteToTeam(context(), {
      teamId: team.id,
      email: "demoted@deletion.test",
      role: "member",
    });
    const target = await projectWithTasks(team.id, "del-race", "DLR");
    const before = await projectContents(target);

    const racingDb = drizzle(env.DB);
    const batch = racingDb.batch.bind(racingDb);
    const intercepted = vi.spyOn(racingDb, "batch").mockImplementation(async (queries) => {
      await changeTeamMemberRole(context(memberId), {
        teamId: team.id,
        userId: ownerId,
        role: "admin",
      });
      return batch(queries);
    });
    const ctx = { ...context(), db: racingDb };
    const deletion = kind === "project"
      ? deleteProject(ctx, { projectId: target.id, confirmation: target.slug })
      : deleteTeam(ctx, { teamId: team.id, confirmation: team.slug });

    await expect(deletion).rejects.toMatchObject({
      name: "AccessError",
      reason: "forbidden",
    });
    expect(intercepted).toHaveBeenCalledTimes(1);
    expect(await projectContents(target)).toEqual(before);
    expect(await teamContents(team.id)).toEqual([1, 2, 1]);
  },
);

it("lists only archived tasks and lets a member restore them without granting permanent deletion", async () => {
  const team = await createTeam(context(), { slug: "del-archive-view", name: "Archive view" });
  const target = await projectWithTasks(team.id, "del-archive-list", "DAV");
  const [liveId, archivedId] = target.taskIds;
  await db.insert(teamMember).values([
    { teamId: team.id, userId: adminId, role: "admin", createdAt: now },
    { teamId: team.id, userId: memberId, role: "member", createdAt: now },
  ]);
  await addProjectMember(context(), { projectId: target.id, userId: memberId });

  const params = Promise.resolve({ team: team.slug, project: target.slug });
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
  await expect(deleteArchivedTaskAction(team.slug, target.slug, archivedId, {}, form("DAV-2")))
    .rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;403" });

  const query = { projectId: target.id };
  const member = context(memberId);
  expect((await listTasks(member, query)).map(({ id }) => id)).toEqual([liveId]);
  expect((await listTasks(member, { ...query, archivedOnly: true })).map(({ id }) => id))
    .toEqual([archivedId]);
  expect(new Set((await listTasks(member, { ...query, includeArchived: true })).map(({ id }) => id)))
    .toEqual(new Set([liveId, archivedId]));

  const restore = new FormData();
  restore.set("team", team.slug);
  restore.set("project", target.slug);
  restore.set("taskId", archivedId);
  restore.set("intent", "unarchive");
  expect(await archiveAction({}, restore)).toEqual({});
  expect(await listTasks(member, { ...query, archivedOnly: true })).toEqual([]);
  expect(new Set((await listTasks(member, query)).map(({ id }) => id)))
    .toEqual(new Set([liveId, archivedId]));
});

it("deletes an archived task and its history only within the confirmed project", async () => {
  const team = await createTeam(context(), { slug: "del-archive-scope", name: "Archive scope" });
  await db.insert(teamMember).values({
    teamId: team.id, userId: adminId, role: "admin", createdAt: now,
  });
  const target = await projectWithTasks(team.id, "del-archive-target", "DAT");
  const neighbor = await projectWithTasks(team.id, "del-archive-neighbor", "DAN");
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
  expect(await deleteArchivedTaskAction(team.slug, target.slug, archivedId, {}, form("DAT-2")))
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
    const team = await createTeam(context(), { slug: `del-archive-${race}`, name: "Archive race" });
    const target = await projectWithTasks(team.id, "del-archive-race", "DAR");
    await db.insert(teamMember).values({
      teamId: team.id, userId: adminId, role: "admin", createdAt: now,
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
        await changeTeamMemberRole(context(), {
          teamId: team.id, userId: adminId, role: "member",
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
