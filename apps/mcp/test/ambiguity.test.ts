import { createOrg, createProject, createTask } from "@tasks/core/domain";
import { user } from "@tasks/core/schema";
import { beforeAll, expect, it } from "vitest";
import { call, db } from "./helpers";

// One user owning two orgs that each have a project keyed `WEB` (§3 makes keys
// unique per org only). `amb-` prefix: storage is shared across the run.
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
    const o = await createOrg(ctx, { slug, name: slug });
    const p = await createProject(ctx, { orgId: o.id, slug: "site", name: "Site", key: "WEB" });
    await createTask(ctx, { projectId: p.id, title: `in ${slug}` });
  }
});

it("refuses an ambiguous key and names the orgs that would disambiguate it", async () => {
  const result = await call(U, "get_task", { task: "WEB-1" });
  expect(result.isError).toBe(true);
  expect(result.data).toContain("amb-one, amb-two");
});

it("accepts an org-qualified project or task", async () => {
  const t = await call(U, "get_task", { task: "amb-two/WEB-1" });
  expect(t.data.title).toBe("in amb-two");
  const list = await call(U, "list_tasks", { project: "amb-one/site" });
  expect(list.data.tasks.map((x: any) => x.title)).toEqual(["in amb-one"]);
});
