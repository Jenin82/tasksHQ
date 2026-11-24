import { applyD1Migrations, env } from "cloudflare:test";
import { expect, it } from "vitest";

it("0021 creates the org row on a fresh install with no teams", async () => {
  const db = env.MIGRATION_DB;
  const startedAt = Date.now();
  await applyD1Migrations(db, env.MIGRATIONS);

  const rows = (
    await db.prepare("SELECT id, name, created_at FROM org").all<{
      id: string;
      name: string;
      created_at: number;
    }>()
  ).results;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: "org", name: "TasksHQ" });
  expect(rows[0].created_at).toBeGreaterThanOrEqual(startedAt - 60_000);
  expect(rows[0].created_at).toBeLessThanOrEqual(Date.now() + 60_000);
  expect(
    (await db.prepare("SELECT count(*) AS n FROM org_member").first<{ n: number }>())!.n,
  ).toBe(0);
});
