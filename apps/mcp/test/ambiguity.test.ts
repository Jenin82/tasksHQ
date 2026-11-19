import { createProject, createTask } from "@tasks/core/domain";
import { orgMember, user } from "@tasks/core/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, db, createTeam } from "./helpers";

// One user owning two teams that each have a project keyed `WEB` (§3 makes keys
// unique per team only). `amb-` prefix: storage is shared across the run.
const U = "amb-user";
const ctx = { db, actorUserId: U, source: "web" as const };

beforeAll(async () => {
  const now = new Date();
  await db.insert(user).values({
    id: U,
    name: "Amb",
    email: "amb@example.test",
    createdAt: now,
    updatedAt: now,
  });
  for (const slug of ["amb-one", "amb-two"]) {
    const o = await createTeam(ctx, { slug, name: slug });
    const p = await createProject(ctx, { teamId: o.id, slug: "site", name: "Site", key: "WEB" });
    await createTask(ctx, { projectId: p.id, title: `in ${slug}` });
  }
  const solo = await createProject(ctx, {
    teamId: (await createTeam(ctx, { slug: "amb-solo", name: "amb-solo" })).id,
    slug: "solo",
    name: "Solo",
    key: "SOLO",
  });
  await createTask(ctx, { projectId: solo.id, title: "in amb-solo" });
});

it("refuses an ambiguous key and names the teams that would disambiguate it", async () => {
  const result = await call(U, "get_task", { task: "WEB-1" });
  expect(result.isError).toBe(true);
  expect(result.data).toContain("amb-one, amb-two");
});

it("accepts a team-qualified project or task", async () => {
  const t = await call(U, "get_task", { task: "amb-two/WEB-1" });
  expect(t.data.title).toBe("in amb-two");
  const list = await call(U, "list_tasks", { project: "amb-one/site" });
  expect(list.data.tasks.map((x: any) => x.title)).toEqual(["in amb-one"]);
});

describe("an org admin, who reaches every team", () => {
  const A = "amb-org-admin";
  const actx = { db, actorUserId: A, source: "web" as const };

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values({ id: A, name: "Amb Admin", email: "amb-admin@example.test", createdAt: now, updatedAt: now });
    const three = await createTeam(actx, { slug: "amb-three", name: "amb-three" });
    const four = await createTeam(actx, { slug: "amb-four", name: "amb-four" });
    for (const [t, key] of [[three, "WEB"], [three, "DUP"], [four, "DUP"]] as const) {
      const p = await createProject(actx, { teamId: t.id, slug: key.toLowerCase(), name: key, key });
      await createTask(actx, { projectId: p.id, title: `${key} in ${t.slug}` });
    }
    // Joining a team made them an org member; promote them.
    await db.update(orgMember).set({ role: "admin" }).where(eq(orgMember.userId, A));
  });

  // Storage is shared across the run: no lasting org admin for other files.
  afterAll(async () => {
    await db.update(orgMember).set({ role: "member" }).where(eq(orgMember.userId, A));
  });

  it("resolves a bare key in their own team over teams reached through the org", async () => {
    const t = await call(A, "get_task", { task: "WEB-1" });
    expect(t.isError).toBe(false);
    expect(t.data.title).toBe("WEB in amb-three");
    const list = await call(A, "list_tasks", { project: "WEB" });
    expect(list.data.tasks.map((x: any) => x.title)).toEqual(["WEB in amb-three"]);
  });

  it("still resolves a key that only a team reached through the org has", async () => {
    const t = await call(A, "get_task", { task: "SOLO-1" });
    expect(t.isError).toBe(false);
    expect(t.data.title).toBe("in amb-solo");
  });

  it("refuses a key matching two of their own teams", async () => {
    const result = await call(A, "get_task", { task: "DUP-1" });
    expect(result.isError).toBe(true);
    expect(result.data).toContain("amb-four, amb-three");
  });
});
