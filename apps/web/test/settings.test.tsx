import { env } from "cloudflare:test";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";
import {
  addProjectMember,
  createOrg,
  createProject,
  createStatus,
  createTask,
  deleteStatus,
} from "@tasks/core/domain";
import {
  orgMember,
  status,
  task,
  user,
} from "@tasks/core/schema";

// Same seam as test/board.test.ts: the route layer reads the session through
// this module, and the pool gives no live request context.
const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/session", () => {
  const current = () => ({
    id: actor.id,
    name: actor.id,
    email: `${actor.id}@settings.test`,
  });
  return { getUser: async () => current(), requireUser: async () => current() };
});

const {
  setProjectMemberRoleAction,
  createStatusAction,
  deleteStatusAction,
  recolorStatusAction,
  reorderStatusAction,
} = await import("@/app/[org]/[project]/settings/actions");
const SettingsPage = (
  await import("@/app/[org]/[project]/settings/page")
).default;
const { updateSlackIntegrationAction } = await import("@/app/[org]/[project]/settings/slack-actions");

const db = drizzle(env.DB);
const now = new Date();

// Shared storage (§12: no per-test isolation), so every id and slug is `st-`.
const IDS = ["st-owner", "st-member", "st-stranger"];
await db.insert(user).values(
  IDS.map((id) => ({
    id,
    name: id.toUpperCase(),
    email: `${id}@settings.test`,
    createdAt: now,
    updatedAt: now,
  })),
);

const ownerCtx = { db, actorUserId: "st-owner", source: "web" as const };

actor.id = "st-owner";
const acme = await createOrg(ownerCtx, { slug: "st-acme", name: "ST Acme" });
await db.insert(orgMember).values({
  orgId: acme.id,
  userId: "st-member",
  role: "member",
  createdAt: now,
});

/** vinext's navigation errors carry Next's digest; 404 and 403 differ only there. */
const digest = (code: number) => ({
  digest: `NEXT_HTTP_ERROR_FALLBACK;${code}`,
});

async function freshProject(slug: string, key: string) {
  const project = await createProject(ownerCtx, {
    orgId: acme.id,
    slug,
    name: slug,
    key,
  });
  return { project, statuses: await columns(project.id) };
}

/** Board order: `(position, id)`, the same order the board and table read. */
function columns(projectId: string) {
  return db
    .select()
    .from(status)
    .where(eq(status.projectId, projectId))
    .orderBy(asc(status.position), asc(status.id));
}

function form(projectSlug: string, fields: Record<string, string>) {
  const data = new FormData();
  data.set("org", "st-acme");
  data.set("project", projectSlug);
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function render(projectSlug: string) {
  return SettingsPage({
    params: Promise.resolve({ org: "st-acme", project: projectSlug }),
  }).then(renderToStaticMarkup);
}

it("denies project settings and settings mutations to a regular member", async () => {
  actor.id = "st-owner";
  const { statuses: [todo] } = await freshProject("st-readonly", "STR");

  actor.id = "st-member";
  await expect(render("st-readonly")).rejects.toMatchObject(digest(403));
  await expect(
    createStatusAction(
      {},
      form("st-readonly", { name: "Waiting", color: "red" }),
    ),
  ).rejects.toMatchObject(digest(403));
  await expect(
    recolorStatusAction({}, form("st-readonly", { statusId: todo.id, color: "green" })),
  ).rejects.toMatchObject(digest(403));
  actor.id = "st-owner";
  const editable = await render("st-readonly");
  expect(editable).toContain("Add status");
  expect(editable).toContain("Project admins");
  expect(editable).not.toContain("Invite");
  expect(editable).toContain('aria-label="Color of Todo: Grey"');
  expect(editable).not.toContain('name="category"');
  expect(editable).not.toContain("Category of Todo");
  expect(editable).not.toContain("Category default");
});

it("gives Slack managers a webhook setup link and keeps the saved credential out of the page", async () => {
  actor.id = "st-owner";
  const slug = "st-slack";
  const { project } = await freshProject(slug, "STK");
  await addProjectMember(ownerCtx, { projectId: project.id, userId: "st-member" });
  const submit = (fields: Record<string, string>) => updateSlackIntegrationAction("st-acme", slug, {}, form(slug, fields));

  const initial = await render(slug);
  const help = initial.match(/<a\b[^>]*aria-label="How to get a Slack webhook URL[^>]*>\?<\/a>/)?.[0];
  expect(help).toContain('href="https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/');
  expect(help).toContain('target="_blank"');
  expect(help).toContain('rel="noopener noreferrer"');

  const webhook = "https://hooks.slack.com/services/T00000000/B00000000/settingsFixture00000000000";
  await expect(submit({ operation: "save", webhook })).resolves.toMatchObject({ notice: expect.any(String) });
  const configured = await render(slug);
  expect(configured).toContain("Replace webhook");
  expect(configured).toContain("Send test message");
  expect(configured).not.toContain(webhook);

  actor.id = "st-member";
  await expect(render(slug)).rejects.toMatchObject(digest(403));
  await expect(submit({ operation: "disconnect" })).rejects.toMatchObject(digest(403));
});

it("the color action saves only explicit palette colors, including for a legacy status", async () => {
  actor.id = "st-owner";
  const slug = "st-color";
  const { project, statuses: [todo] } = await freshProject(slug, "STC");
  const submit = (fields: Record<string, string>) =>
    recolorStatusAction({}, form(slug, { statusId: todo.id, ...fields }));

  await db.update(status).set({ color: null }).where(eq(status.id, todo.id));
  expect(await render(slug)).toContain('aria-label="Color of Todo: Grey"');
  expect(await submit({ color: "gray" })).toEqual({});
  expect((await columns(project.id))[0].color).toBe("gray");

  for (const [color, label] of [
    ["yellow", "Yellow"],
    ["orange", "Orange"],
    ["purple", "Purple"],
    ["pink", "Pink"],
  ]) {
    expect(await submit({ color })).toEqual({});
    expect((await columns(project.id))[0]).toEqual({ ...todo, color });
    expect(await render(slug)).toContain(`aria-label="Color of Todo: ${label}"`);
  }

  const invalid: Record<string, string>[] = [{}, { color: "" }, { color: "rainbow" }];
  for (const fields of invalid) {
    expect(await submit(fields)).toMatchObject({ error: expect.any(String) });
    expect((await columns(project.id))[0].color).toBe("pink");
  }
});

it("deleting a status is blocked while tasks reference it, and moves them when given a target", async () => {
  actor.id = "st-owner";
  const { project, statuses } = await freshProject("st-delete", "STD");
  const [todo, , done] = statuses;

  const one = await createTask(ownerCtx, {
    projectId: project.id,
    title: "One",
  });
  const two = await createTask(ownerCtx, {
    projectId: project.id,
    title: "Two",
  });

  // Refused, and as an inline sentence naming the count — not a thrown
  // constraint failure.
  const blocked = await deleteStatusAction(
    {},
    form("st-delete", { statusId: todo.id }),
  );
  expect(blocked.error).toMatch(/still holds 2 task/);
  expect(await columns(project.id)).toEqual(statuses);

  const moved = await deleteStatusAction(
    {},
    form("st-delete", { statusId: todo.id, moveTasksTo: done.id }),
  );
  expect(moved.error).toBeUndefined();

  expect((await columns(project.id)).map((s) => s.name)).toEqual([
    "In Progress",
    "Done",
    "Blocked",
  ]);
  // §3: tasks are never cascade-deleted — both are still here, in Done.
  const tasks = await db
    .select({ id: task.id, statusId: task.statusId })
    .from(task)
    .where(eq(task.projectId, project.id));
  expect(tasks).toHaveLength(2);
  expect(tasks.every((t) => t.statusId === done.id)).toBe(true);
  expect(new Set(tasks.map((t) => t.id))).toEqual(new Set([one.id, two.id]));
});

it("lets org managers grant and revoke scoped project administration without changing access", async () => {
  actor.id = "st-owner";
  const { project } = await freshProject("st-admins", "STO");
  const other = await freshProject("st-other", "STX");
  const submit = (userId: string, role: string) =>
    setProjectMemberRoleAction({}, form(project.slug, { userId, role }));

  expect(await render(project.slug)).toContain("Grant admin access");
  expect(await submit("st-stranger", "admin")).toMatchObject({ error: expect.stringMatching(/organization/i) });
  expect(await submit("st-member", "admin")).toEqual({});
  expect(await render(project.slug)).toContain("Revoke admin access");

  actor.id = "st-member";
  const scoped = await render(project.slug);
  expect(scoped).toContain("Add status");
  expect(scoped).not.toContain("Grant admin access");
  expect(scoped).not.toContain("Revoke admin access");
  await expect(render(other.project.slug)).rejects.toMatchObject(digest(403));
  await expect(submit("st-member", "member")).rejects.toMatchObject(digest(403));

  actor.id = "st-owner";
  expect(await submit("st-member", "member")).toEqual({});
  actor.id = "st-member";
  await expect(render(project.slug)).rejects.toMatchObject(digest(403));
  actor.id = "st-owner";
});

it("reordering writes one row and changes the board order", async () => {
  actor.id = "st-owner";
  const { project, statuses } = await freshProject("st-reorder", "STE");
  const [todo, doing, done] = statuses;
  const before = new Map(statuses.map((s) => [s.id, s.position]));

  // Done moves to the front: `after` empty is "first" (§16).
  const state = await reorderStatusAction(
    {},
    form("st-reorder", { statusId: done.id, after: "" }),
  );
  expect(state.error).toBeUndefined();

  const after = await columns(project.id);
  expect(after.map((s) => s.name)).toEqual(["Done", "Todo", "In Progress", "Blocked"]);

  // One row, which is the whole point of the fractional index (§3).
  const changed = after.filter((s) => before.get(s.id) !== s.position);
  expect(changed.map((s) => s.id)).toEqual([done.id]);
  expect(before.get(todo.id)).toBe(
    after.find((s) => s.id === todo.id)?.position,
  );
  expect(before.get(doing.id)).toBe(
    after.find((s) => s.id === doing.id)?.position,
  );
});

it("the up and down controls carry the neighbour each move lands behind", async () => {
  actor.id = "st-owner";
  const { project, statuses } = await freshProject("st-arrows", "STA");
  const [todo, doing, done, blocked] = statuses;
  const extra = await createStatus(ownerCtx, {
    projectId: project.id,
    name: "In Review",
    color: "orange",
  });

  // What the page renders: `after` is the status the move lands behind, and
  // an empty value is "first" (§16). Moving up means landing behind the row
  // two above, which is the one piece of arithmetic the page does itself.
  const html = await render("st-arrows");
  const moves = [...html.matchAll(/aria-label="Move ([^"]+?) (up|down)"/g)].map(
    (m) => [m[1], m[2]],
  );
  expect(moves.map(([name, dir]) => `${name} ${dir}`)).toEqual([
    "Todo up",
    "Todo down",
    "In Progress up",
    "In Progress down",
    "Done up",
    "Done down",
    "Blocked up",
    "Blocked down",
    "In Review up",
    "In Review down",
  ]);

  const afters = [
    ...html.matchAll(/<button[^>]*?value="([^"]*)"[^>]*?aria-label="Move [^"]+"/g),
  ].map((m) => m[1]);
  expect(afters).toEqual([
    "", doing.id,        // Todo:        first (disabled) / behind In Progress
    "", done.id,         // In Progress: first / behind Done
    todo.id, blocked.id, // Done:        behind Todo / behind Blocked
    doing.id, extra.id,   // Blocked:     behind In Progress / behind In Review
    done.id, "",         // In Review:   behind Done / last (disabled)
  ]);

  // And the value a real "up" carries does what the row claims: Done moves
  // behind Todo.
  const state = await reorderStatusAction(
    {},
    form("st-arrows", { statusId: done.id, after: todo.id }),
  );
  expect(state.error).toBeUndefined();
  expect((await columns(project.id)).map((s) => s.name)).toEqual([
    "Todo",
    "Done",
    "In Progress",
    "Blocked",
    "In Review",
  ]);
});

it("a project with no statuses can still be given one", async () => {
  actor.id = "st-owner";
  const { project, statuses } = await freshProject("st-empty", "STM");
  for (const s of statuses) {
    await deleteStatus(ownerCtx, { statusId: s.id });
  }
  expect(await columns(project.id)).toHaveLength(0);

  // The last status may be deleted. Creating tasks resumes after adding a
  // status with any name and color.
  const html = await render("st-empty");
  expect(html).toContain("This project has no statuses");
  expect(html).toContain("Add status");
  await expect(
    createTask(ownerCtx, { projectId: project.id, title: "No column" }),
  ).rejects.toThrow(/no statuses/);

  const submit = (fields: Record<string, string>) =>
    createStatusAction({}, form("st-empty", fields));
  expect(await submit({ name: "Waiting", color: "rainbow" })).toMatchObject({
    error: expect.any(String),
  });
  expect(await columns(project.id)).toHaveLength(0);
  expect(await submit({ name: "Waiting", color: "orange" })).toEqual({});
  expect(await submit({ name: "Review" })).toEqual({});
  expect(await columns(project.id)).toMatchObject([
    { name: "Waiting", color: "orange" },
    { name: "Review", color: "gray" },
  ]);
  const created = await createTask(ownerCtx, { projectId: project.id, title: "New task" });
  expect(created.status).toMatchObject({ name: "Waiting", color: "orange" });
});
