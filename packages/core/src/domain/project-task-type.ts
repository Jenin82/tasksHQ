import { and, asc, desc, eq, exists, ne, notExists } from "drizzle-orm";
import { canProject, requireCapability, requireProjectMember } from "../access";
import type { DomainContext } from "../activity";
import { assertMaxLength, DomainError, isConstraintError, MAX_LENGTH } from "../errors";
import { projectTaskType, STATUS_COLORS, TASK_TYPE_ICONS } from "../schema/project";
import { task } from "../schema/task";

type ProjectInput = { projectId: string };
type TypeInput = ProjectInput & { typeId: string };
type TypeFields = { name: string; color?: string; icon?: string };

function typeScope({ projectId, typeId }: TypeInput) {
  return and(eq(projectTaskType.projectId, projectId), eq(projectTaskType.id, typeId));
}

async function requireTypeManager(ctx: DomainContext, projectId: string) {
  const { member, projectRole } = await requireProjectMember(ctx.db, projectId, ctx.actorUserId);
  const capability = "project:manage_statuses";
  if (!canProject(member.role, projectRole, capability)) requireCapability(member.role, capability);
}

function typeName(input: string) {
  const name = input.trim();
  if (!name) throw new DomainError("Task type name is required.");
  assertMaxLength("Task type name", name, MAX_LENGTH.name);
  return name;
}

function typeFields(input: TypeFields) {
  const name = typeName(input.name);
  const color = STATUS_COLORS.find((value) => value === input.color);
  const icon = TASK_TYPE_ICONS.find((value) => value === input.icon);
  if (input.color !== undefined && color === undefined) throw new DomainError("Choose a valid task type color.");
  if (input.icon !== undefined && icon === undefined) throw new DomainError("Choose a valid task type icon.");
  return { name, ...(color && { color }), ...(icon && { icon }) };
}

function duplicateName(error: unknown): never {
  if (isConstraintError(error, "UNIQUE", "project_task_type_project_name_unique")) {
    throw new DomainError("A task type with that name already exists.");
  }
  throw error;
}

export async function listProjectTaskTypes(ctx: DomainContext, { projectId }: ProjectInput) {
  await requireProjectMember(ctx.db, projectId, ctx.actorUserId);
  return ctx.db.select()
    .from(projectTaskType)
    .where(eq(projectTaskType.projectId, projectId))
    .orderBy(desc(projectTaskType.isDefault), asc(projectTaskType.name), asc(projectTaskType.id));
}

export async function createProjectTaskType(ctx: DomainContext, input: ProjectInput & TypeFields) {
  await requireTypeManager(ctx, input.projectId);
  const fields = typeFields(input);
  try {
    const [created] = await ctx.db.insert(projectTaskType)
      .values({ id: crypto.randomUUID(), projectId: input.projectId, ...fields })
      .returning();
    return created;
  } catch (error) {
    duplicateName(error);
  }
}

export async function renameProjectTaskType(ctx: DomainContext, input: TypeInput & TypeFields) {
  await requireTypeManager(ctx, input.projectId);
  const fields = typeFields(input);
  try {
    const [updated] = await ctx.db.update(projectTaskType)
      .set(fields)
      .where(typeScope(input))
      .returning();
    if (!updated) throw new DomainError("No such task type in this project.");
    return updated;
  } catch (error) {
    duplicateName(error);
  }
}

export async function setDefaultProjectTaskType(ctx: DomainContext, input: TypeInput) {
  await requireTypeManager(ctx, input.projectId);
  const { db } = ctx;
  const target = db.select({ id: projectTaskType.id }).from(projectTaskType).where(typeScope(input));
  // D1 runs the batch atomically. Do not unset the current default if the
  // chosen type was deleted before the batch acquired the write lock.
  const [, [updated]] = await db.batch([
    db.update(projectTaskType).set({ isDefault: false }).where(and(
      eq(projectTaskType.projectId, input.projectId),
      eq(projectTaskType.isDefault, true),
      ne(projectTaskType.id, input.typeId),
      exists(target),
    )),
    db.update(projectTaskType).set({ isDefault: true }).where(typeScope(input)).returning(),
  ]);
  if (!updated) throw new DomainError("No such task type in this project.");
  return updated;
}

export async function deleteProjectTaskType(ctx: DomainContext, input: TypeInput) {
  await requireTypeManager(ctx, input.projectId);
  const { db } = ctx;
  const inUse = db.select({ id: task.id }).from(task).where(eq(task.typeId, input.typeId));
  const [deleted] = await db.delete(projectTaskType).where(and(
    typeScope(input),
    eq(projectTaskType.isDefault, false),
    notExists(inUse),
  )).returning({ id: projectTaskType.id });
  if (deleted) return;

  const [current] = await db.select({ isDefault: projectTaskType.isDefault })
    .from(projectTaskType).where(typeScope(input));
  if (!current) throw new DomainError("No such task type in this project.");
  if (current.isDefault) throw new DomainError("Choose another default task type before deleting this one.");
  throw new DomainError("Move tasks using this type to another type before deleting it.");
}
