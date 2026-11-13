import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import {
  addComment,
  archiveTask,
  createTask,
  getTaskDetail,
  listTasks,
  updateTask,
  type TaskDetail,
  type UserRef,
} from "@tasks/core/domain";
import { DomainError } from "@tasks/core/errors";
import { TASK_PRIORITIES } from "@tasks/core/schema";
import {
  MAX_TASK_IMAGE_BYTES,
  TASK_IMAGE_ID,
  storeTaskImage,
  taskImageKey,
  taskImagePath,
} from "@tasks/core/task-images";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";
import type { Props } from "./auth";
import {
  emailsFor,
  projectStatuses,
  projectTaskTypes,
  reachableProjects,
  resolveAssignee,
  resolveProject,
  resolveStatus,
  resolveTask,
  resolveTaskType,
} from "./resolve";

// TODO(core): export `DomainContext` (src/activity.ts is not in package exports).
type DomainContext = Parameters<typeof createTask>[0];

const PROJECT = z
  .string()
  .min(1)
  .describe('Project key or slug, e.g. "ENG" or "web". Prefix "org/" if ambiguous.');
const TASK = z
  .string()
  .min(1)
  .describe('Task key, e.g. "ENG-42". Prefix "org/" if ambiguous.');
const STATUS = z.string().min(1).describe("Status name, as list_projects returns it.");
const ASSIGNEE = z.string().min(1).describe("Assignee email address.");
const REPORTER = z.string().min(1).describe("Reporter email address. Defaults to the task creator.");
const DUE_DATE = z.iso.date().describe("Due date as YYYY-MM-DD, with no time or timezone.");
const PRIORITY = z.enum(TASK_PRIORITIES);
const TASK_TYPE = z.string().min(1).describe("Task type name, as list_projects returns it.");
const DESCRIPTION = z.string().describe(
  "Markdown. To embed a project image, insert the Markdown from upload_project_image.",
);
const MAX_IMAGE_BASE64_LENGTH = 4 * Math.ceil(MAX_TASK_IMAGE_BYTES / 3);
// Allow room for the JSON-RPC envelope around a maximum-size encoded image.
export const MAX_MCP_REQUEST_BYTES = MAX_IMAGE_BASE64_LENGTH + 128 * 1024;

type ImageBindings = Pick<Env, "TASK_IMAGES" | "IMAGES">;

type Person = { email: string | null; displayName: string } | null;

function person(ref: UserRef, emails: Map<string, string>): Person {
  return ref
    ? { email: emails.get(ref.id) ?? null, displayName: ref.displayName }
    : null;
}

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/**
 * A broken rule (including core's non-leaking "No such task.") is a tool
 * error the agent can read and act on. Anything else is a bug and propagates.
 */
async function run<T>(
  fn: () => Promise<T>,
  result: (value: T) => CallToolResult = json,
): Promise<CallToolResult> {
  try {
    return result(await fn());
  } catch (error) {
    if (error instanceof DomainError) {
      return { isError: true, content: [{ type: "text", text: error.message }] };
    }
    throw error;
  }
}

function decodeImage(encoded: string) {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.fromBase64(encoded);
  } catch {
    throw new DomainError("Provide valid base64 image data without a data URL prefix.");
  }
  if (bytes.byteLength > MAX_TASK_IMAGE_BYTES) {
    throw new DomainError("Images must be 5 MB or smaller.");
  }
  return bytes;
}

async function taskView(db: DrizzleD1Database, t: TaskDetail) {
  const emails = await emailsFor(db, [t.assignee?.id, t.reportedBy.id]);
  return {
    key: t.key,
    title: t.title,
    description: t.description,
    dueDate: t.dueDate,
    priority: t.priority,
    type: t.type.name,
    status: t.status.name,
    assignee: person(t.assignee, emails),
    reporter: person(t.reportedBy, emails),
    updatedAt: t.updatedAt,
  };
}

/** Opaque to agents; an offset into `listTasks`' `position, id` order. */
const encodeCursor = (offset: number) => btoa(String(offset));
function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  let offset = Number.NaN;
  try {
    offset = Number(atob(cursor));
  } catch {}
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("Invalid cursor.");
  }
  return offset;
}

/**
 * One server per request (stateless), bound to the
 * caller the token proved. Every mutation is a core domain function called
 * with `source: "mcp"`, which writes the activity row and re-proves reach.
 */
export function buildServer(db: DrizzleD1Database, props: Props, images: ImageBindings): McpServer {
  const ctx: DomainContext = {
    db,
    actorUserId: props.userId,
    source: "mcp",
    clientId: props.clientId,
    clientName: props.clientName,
    emailNotifications: props.emailNotifications === true,
  };
  const server = new McpServer({ name: "taskshq", version: "0.1.0" });

  server.registerTool(
    "list_projects",
    {
      description:
        "Projects you can reach, each with its statuses and task types.",
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => {
        const projects = await reachableProjects(db, props.userId);
        const ids = projects.map((p) => p.id);
        const [statuses, types] = await Promise.all([
          projectStatuses(db, ids),
          projectTaskTypes(db, ids),
        ]);
        return projects.map((p) => ({
          key: p.key,
          slug: p.slug,
          name: p.name,
          org: p.orgSlug,
          statuses: statuses
            .filter((s) => s.projectId === p.id)
            .map((s) => ({ name: s.name, color: s.color ?? "gray" })),
          taskTypes: types
            .filter((type) => type.projectId === p.id)
            .map(({ id, name, color, icon, isDefault }) => ({ id, name, color, icon, isDefault })),
        }));
      }),
  );

  server.registerTool(
    "list_tasks",
    {
      description: "Tasks in a project, in board order. Archived tasks are excluded unless asked for.",
      inputSchema: z.object({
        project: PROJECT,
        status: STATUS.optional(),
        assignee: ASSIGNEE.optional(),
        includeArchived: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().optional().describe("From a previous page's cursor."),
      }),
      annotations: { readOnlyHint: true },
    },
    (args) =>
      run(async () => {
        const offset = decodeCursor(args.cursor);
        const p = await resolveProject(db, props.userId, args.project);
        const statusId = args.status
          ? (await resolveStatus(db, p, args.status)).id
          : undefined;
        const assigneeUserId = args.assignee
          ? await resolveAssignee(db, args.assignee)
          : undefined;

        // TODO(core): `listTasks` has no limit/cursor (§18), so each page
        // reads the whole project and slices here.
        const all = await listTasks(ctx, {
          projectId: p.id,
          statusId,
          assigneeUserId,
          includeArchived: args.includeArchived,
        });
        const page = all.slice(offset, offset + args.limit);
        const emails = await emailsFor(
          db,
          page.flatMap((t) => [t.assignee?.id, t.reportedBy.id]),
        );
        const next = offset + page.length;
        return {
          tasks: page.map((t) => ({
            key: t.key,
            title: t.title,
            dueDate: t.dueDate,
            priority: t.priority,
            type: t.type.name,
            status: t.status.name,
            assignee: person(t.assignee, emails),
            reporter: person(t.reportedBy, emails),
            updatedAt: t.updatedAt,
          })),
          ...(next < all.length ? { cursor: encodeCursor(next) } : {}),
        };
      }),
  );

  server.registerTool(
    "get_task",
    {
      description: "One task with its type, Markdown description, due date, priority, comments and activity log.",
      inputSchema: z.object({ task: TASK }),
      annotations: { readOnlyHint: true },
    },
    (args) =>
      run(async () => {
        const { taskId, project, number } = await resolveTask(db, props.userId, args.task);
        const t = await getTaskDetail(ctx, { taskId, projectId: project.id, number });
        const emails = await emailsFor(db, [
          t.assignee?.id,
          t.reportedBy.id,
          ...t.comments.map((c) => c.author.id),
          ...t.activity.map((a) => a.actor.id),
        ]);
        return {
          key: t.key,
          title: t.title,
          description: t.description,
          dueDate: t.dueDate,
          priority: t.priority,
          type: t.type.name,
          status: t.status.name,
          assignee: person(t.assignee, emails),
          reporter: person(t.reportedBy, emails),
          archivedAt: t.archivedAt,
          updatedAt: t.updatedAt,
          comments: t.comments.map((c) => ({
            id: c.id,
            author: person(c.author, emails),
            body: c.body,
            source: c.source,
            createdAt: c.createdAt,
          })),
          activity: t.activity.map((a) => ({
            type: a.type,
            data: a.data,
            actor: person(a.actor, emails),
            source: a.source,
            clientName: a.clientName,
            createdAt: a.createdAt,
          })),
        };
      }),
  );

  server.registerTool(
    "create_task",
    {
      description:
        "Create a task with an optional Markdown description and due date. Omit type to use the project's default. Priority defaults to medium. Without a status it lands in the project's first board column. The reporter defaults to you.",
      inputSchema: z.object({
        project: PROJECT,
        title: z.string().min(1),
        description: DESCRIPTION.optional(),
        dueDate: DUE_DATE.optional(),
        priority: PRIORITY.optional(),
        type: TASK_TYPE.optional(),
        status: STATUS.optional(),
        assignee: ASSIGNEE.optional(),
        reporter: REPORTER.optional(),
      }),
    },
    (args) =>
      run(async () => {
        const p = await resolveProject(db, props.userId, args.project);
        const t = await createTask(ctx, {
          projectId: p.id,
          title: args.title,
          description: args.description,
          dueDate: args.dueDate,
          priority: args.priority,
          typeId: args.type === undefined ? undefined : (await resolveTaskType(db, p, args.type)).id,
          statusId: args.status
            ? (await resolveStatus(db, p, args.status)).id
            : undefined,
          assigneeUserId: args.assignee
            ? await resolveAssignee(db, args.assignee)
            : undefined,
          reporterUserId: args.reporter
            ? await resolveAssignee(db, args.reporter)
            : undefined,
        });
        return taskView(db, t);
      }),
  );

  server.registerTool(
    "update_task",
    {
      description:
        "Change a task's type, title, Markdown description, due date, priority, status, assignee or reporter. Omit fields to keep them. Null clears the description, due date or assignee and resets priority to medium. The reporter cannot be cleared.",
      inputSchema: z.object({
        task: TASK,
        title: z.string().min(1).optional(),
        description: DESCRIPTION.nullable().optional(),
        dueDate: DUE_DATE.nullable().optional(),
        priority: PRIORITY.nullable().optional(),
        type: TASK_TYPE.optional(),
        status: STATUS.optional(),
        assignee: ASSIGNEE.nullable().optional(),
        reporter: REPORTER.optional(),
      }),
    },
    (args) =>
      run(async () => {
        const { taskId, project: p, number } = await resolveTask(
          db,
          props.userId,
          args.task,
        );
        const t = await updateTask(ctx, {
          taskId,
          projectId: p.id,
          number,
          title: args.title,
          description: args.description,
          dueDate: args.dueDate,
          priority: args.priority === null ? "medium" : args.priority,
          typeId: args.type === undefined ? undefined : (await resolveTaskType(db, p, args.type)).id,
          statusId: args.status
            ? (await resolveStatus(db, p, args.status)).id
            : undefined,
          assigneeUserId:
            args.assignee === undefined
              ? undefined
              : args.assignee === null
                ? null
                : await resolveAssignee(db, args.assignee),
          reporterUserId: args.reporter
            ? await resolveAssignee(db, args.reporter)
            : undefined,
        });
        return taskView(db, t);
      }),
  );

  server.registerTool(
    "add_comment",
    {
      description: "Comment on a task.",
      inputSchema: z.object({ task: TASK, body: z.string().min(1) }),
    },
    (args) =>
      run(async () => {
        const { taskId, project, number } = await resolveTask(db, props.userId, args.task);
        const c = await addComment(ctx, { taskId, projectId: project.id, number, body: args.body });
        return { commentId: c.id, createdAt: c.createdAt };
      }),
  );

  server.registerTool(
    "archive_task",
    {
      description:
        "Archive a task. It can only be unarchived from the web app.",
      inputSchema: z.object({ task: TASK }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    (args) =>
      run(async () => {
        const { taskId, project, number } = await resolveTask(db, props.userId, args.task);
        const t = await archiveTask(ctx, { taskId, projectId: project.id, number });
        return { key: t.key, archivedAt: t.archivedAt };
      }),
  );

  server.registerTool(
    "upload_project_image",
    {
      description: "Upload a private project image for a task description. Insert the returned Markdown in a task in the same project.",
      inputSchema: z.object({
        project: PROJECT,
        base64: z.string().min(1).max(MAX_IMAGE_BASE64_LENGTH).describe(
          "Raw base64 for a PNG, JPEG, WebP, GIF, or AVIF image of at most 5 MB.",
        ),
      }),
      annotations: { destructiveHint: false },
    },
    (args) =>
      run(async () => {
        const project = await resolveProject(db, props.userId, args.project);
        const imageId = await storeTaskImage(images, project.id, decodeImage(args.base64));
        const path = taskImagePath(project.orgSlug, project.slug, imageId);
        return { imageId, path, markdown: `![Task image](${path})` };
      }),
  );

  server.registerTool(
    "get_project_image",
    {
      description: "Read a private project image. Use the image ID from upload_project_image or the last segment of its Markdown path.",
      inputSchema: z.object({
        project: PROJECT,
        imageId: z.string().regex(TASK_IMAGE_ID),
      }),
      annotations: { readOnlyHint: true },
    },
    (args) =>
      run(async () => {
        const project = await resolveProject(db, props.userId, args.project);
        const image = await images.TASK_IMAGES.get(taskImageKey(project.id, args.imageId));
        if (!image) throw new DomainError("No such image.");
        if (image.httpMetadata?.contentType !== "image/webp") {
          await image.body.cancel();
          throw new DomainError("No such image.");
        }
        if (image.size > MAX_TASK_IMAGE_BYTES) {
          await image.body.cancel();
          throw new DomainError("This image is too large to return.");
        }
        const data = new Uint8Array(await image.arrayBuffer()).toBase64();
        return { type: "image" as const, data, mimeType: "image/webp" };
      }, (image) => ({ content: [image] })),
  );

  return server;
}
