import { applyD1Migrations, env } from "cloudflare:test";
import { expect, it } from "vitest";

// MIGRATION_DB is a separate, unmigrated database: test/setup.ts migrates
// env.DB fully, which hides the pre-0021 schema this test needs to seed.
const db = env.MIGRATION_DB;
const before = env.MIGRATIONS.filter((m) => m.name < "0021");
const orgLayer = env.MIGRATIONS.filter((m) => m.name.startsWith("0021"));

const all = async <T>(sql: string, ...params: unknown[]) =>
  (await db.prepare(sql).bind(...params).all<T>()).results;
const count = async (table: string) =>
  (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

it("0021 adds the org, backfills members from teams and keeps them in step", async () => {
  expect(orgLayer).toHaveLength(1);
  await applyD1Migrations(db, before);

  const t = 1_700_000_000_000;
  await db.batch([
    db.prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES
        ('u-a', 'A', 'a@m.test', 1, ${t}, ${t}),
        ('u-b', 'B', 'b@m.test', 1, ${t}, ${t}),
        ('u-c', 'C', 'c@m.test', 1, ${t}, ${t})`,
    ),
    // The oldest team wins by created_at, not by name.
    db.prepare(
      `INSERT INTO team (id, slug, name, created_at) VALUES
        ('t-new', 'alpha', 'Alpha', ${t + 1000}), ('t-old', 'zeta', 'Zeta', ${t})`,
    ),
    db.prepare(
      `INSERT INTO team_member (team_id, user_id, role, created_at) VALUES
        ('t-old', 'u-a', 'owner', ${t + 5}),
        ('t-old', 'u-b', 'member', ${t + 2}),
        ('t-new', 'u-a', 'member', ${t + 1}),
        ('t-new', 'u-b', 'admin', ${t + 3}),
        ('t-new', 'system-automation', 'member', ${t + 4})`,
    ),
    db.prepare(
      `INSERT INTO team_invite (team_id, email, role, invited_by_user_id, created_at)
        VALUES ('t-old', 'new@m.test', 'member', 'u-a', ${t})`,
    ),
  ]);

  await applyD1Migrations(db, orgLayer);

  expect(await all("SELECT id, name, created_at FROM org")).toEqual([
    { id: "org", name: "Zeta", created_at: t },
  ]);
  // One row per real member, from their earliest membership; any team owner
  // becomes org owner; the automation user is left out.
  expect(await all("SELECT user_id, role, created_at FROM org_member ORDER BY user_id")).toEqual([
    { user_id: "u-a", role: "owner", created_at: t + 1 },
    { user_id: "u-b", role: "member", created_at: t + 2 },
  ]);
  // Pending team invites are untouched and no org invites are created.
  expect(await count("team_invite")).toBe(1);
  expect(await count("org_invite")).toBe(0);

  const triggers = new Set(
    (await all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger'")).map(
      (r) => r.name,
    ),
  );
  for (const name of [
    "project_seed_task_types",
    "task_fill_default_type",
    "task_fill_default_reporter",
    "task_parent_check_insert",
    "task_parent_check_update",
    "team_member_join_org",
    "org_member_leave_teams",
  ]) {
    expect(triggers, name).toContain(name);
  }

  // Joining a team adds an org member, without downgrading an existing role.
  await db.batch([
    db.prepare(`INSERT INTO team (id, slug, name, created_at) VALUES ('t-3', 'third', 'Third', ${t})`),
    db.prepare(
      `INSERT INTO team_member (team_id, user_id, role, created_at) VALUES
        ('t-new', 'u-c', 'member', ${t + 10}), ('t-3', 'u-a', 'member', ${t + 11})`,
    ),
  ]);
  expect(await all("SELECT user_id, role, created_at FROM org_member ORDER BY user_id")).toEqual([
    { user_id: "u-a", role: "owner", created_at: t + 1 },
    { user_id: "u-b", role: "member", created_at: t + 2 },
    { user_id: "u-c", role: "member", created_at: t + 10 },
  ]);

  // Leaving the org removes every team membership and what cascades from it.
  await db.batch([
    db.prepare(
      `INSERT INTO project (id, team_id, slug, name, key, created_at) VALUES ('p1', 't-old', 'web', 'Web', 'WEB', ${t})`,
    ),
    db.prepare(
      `INSERT INTO project_member (team_id, project_id, user_id, role) VALUES ('t-old', 'p1', 'u-b', 'admin')`,
    ),
    db.prepare(
      `INSERT INTO team_reporting_line (team_id, user_id, lead_user_id) VALUES
        ('t-old', 'u-b', 'u-a'), ('t-new', 'u-c', 'u-b')`,
    ),
  ]);
  await db.prepare("DELETE FROM org_member WHERE user_id = 'u-b'").run();
  expect(await count("team_member WHERE user_id = 'u-b'")).toBe(0);
  expect(await count("team_member")).toBe(5);
  expect(await count("project_member")).toBe(0);
  expect(await count("team_reporting_line")).toBe(0);
  expect(await all("PRAGMA foreign_key_check")).toEqual([]);
});
