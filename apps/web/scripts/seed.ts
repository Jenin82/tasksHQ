/**
 * Dev seed: one org, one project, its four default statuses and 12 tasks, so
 * steps 8-10 have something to look at.
 *
 *   pnpm --filter web seed              # synthetic members only
 *   pnpm --filter web seed you@you.com  # plus you, as a second owner
 *
 * If that address already has a `user` row it is added to the org directly;
 * otherwise a pending owner invite is left for it, which `claimInvites` picks
 * up on your first sign-in (§4.4).
 *
 * Re-runnable: it deletes everything under the `acme` slug first.
 *
 * Talks to the local D1 file the vinext dev server reads
 * (`apps/web/.cloudflare/state/v3/d1/...`) through `node:sqlite`, because
 * `cf d1 query --local` has no local equivalent (§12). Local only.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import {
  addProjectMember,
  claimInvites,
  createOrg,
  createProject,
  createTask,
  inviteToOrg,
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

const ORG_SLUG = "acme";
const PROJECT_SLUG = "web";

const D1_DIR = path.join(
  import.meta.dirname,
  "..",
  ".cloudflare",
  "state",
  "v3",
  "d1",
  "miniflare-D1DatabaseObject",
);

// Miniflare names each file by a hash of the database ID, so the file for
// TASKSHQ_D1_ID cannot be picked by name. Warn when the choice is ambiguous.
const files = fs
  .readdirSync(D1_DIR)
  .filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
const file = files[0];
if (files.length > 1) {
  console.warn(
    `Found ${files.length} local D1 databases in ${D1_DIR}; seeding ${file}, which may not be the one the dev server uses for TASKSHQ_D1_ID. ` +
      `Stale files are left over from earlier TASKSHQ_D1_ID values; if you no longer need their data, you can remove them from that directory.`,
  );
}
if (!file) {
  throw new Error(
    `No local D1 database in ${D1_DIR}. Run the dev server once, and apply migrations.`,
  );
}

const sqlite = new DatabaseSync(path.join(D1_DIR, file));

// The domain layer takes a D1-backed drizzle instance. node:sqlite is the only
// way to reach the local file, so it is wrapped in drizzle's generic sqlite
// proxy and cast — the two drivers differ in how they connect, not in the SQL
// the query builder emits.
const proxy = async (sql: string, params: unknown[], method: string) => {
  const stmt = sqlite.prepare(sql);
  if (method === "run") {
    stmt.run(...(params as never[]));
    return { rows: [] };
  }
  stmt.setReturnArrays(true);
  const rows = stmt.all(...(params as never[])) as unknown as unknown[][];
  return { rows: method === "get" ? (rows[0] ?? []) : rows };
};

// §25: every multi-write domain mutation is one `db.batch`, which D1 runs as a
// single transaction. sqlite-proxy has no batch unless given this callback,
// and it must be transactional too, or the NOT NULL sentinel in
// `removeOrgMember` would fail after half the batch had committed.
const db = drizzle(proxy, async (queries) => {
  sqlite.exec("BEGIN");
  try {
    const out = [];
    for (const q of queries) out.push(await proxy(q.sql, q.params, q.method));
    sqlite.exec("COMMIT");
    return out;
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
}) as unknown as DrizzleD1Database;

const now = new Date();

async function reset() {
  const [existing] = await db.select().from(org).where(eq(org.slug, ORG_SLUG));
  if (!existing) return;

  const projects = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.orgId, existing.id));
  const projectIds = projects.map((p) => p.id);

  if (projectIds.length > 0) {
    const tasks = await db
      .select({ id: task.id })
      .from(task)
      .where(inArray(task.projectId, projectIds));
    const taskIds = tasks.map((t) => t.id);
    if (taskIds.length > 0) {
      await db.delete(comment).where(inArray(comment.taskId, taskIds));
    }
    await db.delete(activity).where(inArray(activity.projectId, projectIds));
    await db.delete(task).where(inArray(task.projectId, projectIds));
    await db
      .delete(projectMember)
      .where(inArray(projectMember.projectId, projectIds));
    await db.delete(status).where(inArray(status.projectId, projectIds));
    await db.delete(project).where(inArray(project.id, projectIds));
  }

  await db.delete(orgInvite).where(eq(orgInvite.orgId, existing.id));
  await db.delete(orgMember).where(eq(orgMember.orgId, existing.id));
  await db.delete(org).where(eq(org.id, existing.id));
}

async function ensureUser(id: string, name: string, email: string) {
  await db
    .insert(user)
    .values({ id, name, email, emailVerified: true, createdAt: now, updatedAt: now })
    .onConflictDoNothing();
  return id;
}

await reset();

const ana = await ensureUser("seed-ana", "Ana Ruiz", "ana@seed.local");
const ben = await ensureUser("seed-ben", "Ben Okafor", "ben@seed.local");

const ctx = { db, actorUserId: ana, source: "web" as const };

const acme = await createOrg(ctx, { slug: ORG_SLUG, name: "Acme" });

// Ben joins the way a real member does: invited, then claimed at sign-in.
await inviteToOrg(ctx, { orgId: acme.id, email: "ben@seed.local", role: "member" });
await claimInvites(db, ben, "ben@seed.local");

const you = process.argv[2]?.trim().toLowerCase();
// Google may store the address with capitals; the invite flow lowercases.
const [existingUser] = you
  ? await db.select().from(user).where(sql`lower(${user.email}) = ${you}`)
  : [];
if (you) {
  await inviteToOrg(ctx, { orgId: acme.id, email: you, role: "owner" });
  if (existingUser) {
    await claimInvites(db, existingUser.id, you);
  }
}

const web = await createProject(ctx, {
  orgId: acme.id,
  slug: PROJECT_SLUG,
  name: "Web App",
  key: "WEB",
});
await addProjectMember(ctx, { projectId: web.id, userId: ben });
if (existingUser) {
  await addProjectMember(ctx, { projectId: web.id, userId: existingUser.id });
}

const statuses = await db
  .select()
  .from(status)
  .where(eq(status.projectId, web.id))
  .orderBy(status.position, status.id);

const TASKS: Array<{ title: string; column: number; assignee: string | null }> = [
  { title: "Set up the board route", column: 0, assignee: "seed-ana" },
  { title: "Empty state for a project with no tasks", column: 0, assignee: null },
  { title: "Keyboard shortcuts for moving a card", column: 0, assignee: "seed-ben" },
  { title: "Decide on the task detail URL shape", column: 0, assignee: null },
  { title: "Audit tabular numerals on the card footer", column: 0, assignee: "seed-ana" },
  { title: "Drag and drop between columns", column: 1, assignee: "seed-ana" },
  { title: "Table view column sizing", column: 1, assignee: "seed-ben" },
  { title: "Status reorder writes one row", column: 1, assignee: null },
  { title: "Activity log renders web and MCP badges", column: 1, assignee: "seed-ben" },
  { title: "Org member invite flow", column: 2, assignee: "seed-ana" },
  { title: "Reserved slug denylist", column: 2, assignee: "seed-ana" },
  { title: "Default status seeding", column: 2, assignee: "seed-ben" },
];

// Through the real domain function, so the seed exercises key allocation,
// fractional positions and the `task.created` activity rows the board and the
// activity log read back.
for (const t of TASKS) {
  await createTask(ctx, {
    projectId: web.id,
    title: t.title,
    statusId: statuses[t.column].id,
    assigneeUserId: t.assignee,
  });
}

sqlite.close();

console.log(
  `Seeded org "${ORG_SLUG}", project "${PROJECT_SLUG}" (WEB), ${statuses.length} statuses, ${TASKS.length} tasks.`,
);
if (you) {
  console.log(`Invited ${you} as an owner.`);
}
