import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import {
  addProjectMember,
  createOrg,
  createProject,
  createProjectTaskType,
  createTask,
  deleteProjectTaskType,
  listProjectTaskTypes,
  renameProjectTaskType,
  setDefaultProjectTaskType,
} from "@tasks/core/domain";
import { orgMember, task, user } from "@tasks/core/schema";

const db = drizzle(env.DB);
const ownerId = "task-types-owner";
const memberId = "task-types-member";
const now = new Date();
await db.insert(user).values([ownerId, memberId].map((id) => ({
  id, name: id, email: `${id}@tasks.test`, createdAt: now, updatedAt: now,
})));
const owner = { db, actorUserId: ownerId, source: "web" as const };
const org = await createOrg(owner, { name: "Task type tests", slug: "task-type-tests" });
await db.insert(orgMember).values({ orgId: org.id, userId: memberId, role: "member", createdAt: now });

it("seeds types, guards management, and keeps a default through invalid changes", async () => {
  const project = await createProject(owner, { orgId: org.id, key: "TY", name: "Types", slug: "types" });
  const projectId = project.id;
  const types = await listProjectTaskTypes(owner, { projectId });
  expect(types.map(({ name, isDefault }) => [name, isDefault])).toEqual([
    ["Task", true], ["Bug", false], ["Feature", false], ["Knowledge Transfer (KT)", false],
  ]);
  expect(types.map(({ color, icon }) => [color, icon])).toEqual([
    ["gray", "task"], ["red", "bug"], ["blue", "feature"], ["purple", "book"],
  ]);
  const defaultType = types[0];
  const target = { projectId, typeId: defaultType.id };
  await expect(deleteProjectTaskType(owner, target)).rejects.toThrow("Choose another default task type");
  await expect(setDefaultProjectTaskType(owner, { projectId, typeId: "missing" })).rejects.toThrow("No such task type");

  const member = { ...owner, actorUserId: memberId };
  await addProjectMember(owner, { projectId, userId: memberId });
  expect(await listProjectTaskTypes(member, { projectId })).toEqual(types);
  await expect(createProjectTaskType(member, { projectId, name: "Support" })).rejects.toMatchObject({ reason: "forbidden" });
  await expect(createProjectTaskType(owner, { projectId, name: " bug " })).rejects.toThrow("already exists");
  await expect(createProjectTaskType(owner, { projectId, name: "Support", color: "navy" })).rejects.toThrow("valid task type color");
  await expect(createProjectTaskType(owner, { projectId, name: "Support", icon: "smile" })).rejects.toThrow("valid task type icon");

  const custom = await createProjectTaskType(owner, { projectId, name: " Support ", color: "green", icon: "wrench" });
  await renameProjectTaskType(owner, { projectId, typeId: custom.id, name: "Maintenance", color: "orange" });
  const created = await createTask(owner, { projectId, title: "A preexisting task" });
  await setDefaultProjectTaskType(owner, { projectId, typeId: custom.id });

  const [stored] = await db.select({ typeId: task.typeId }).from(task).where(eq(task.id, created.id));
  expect(stored.typeId).toBe(defaultType.id);
  await expect(deleteProjectTaskType(owner, target)).rejects.toThrow("Move tasks using this type");
  expect((await listProjectTaskTypes(owner, { projectId })).filter((type) => type.isDefault)).toMatchObject([
    { id: custom.id, name: "Maintenance", color: "orange", icon: "wrench" },
  ]);
  await deleteProjectTaskType(owner, { projectId, typeId: types[1].id });
  expect((await listProjectTaskTypes(owner, { projectId })).map(({ id }) => id)).not.toContain(types[1].id);
});
