import { applyD1Migrations, env } from "cloudflare:test";
import { expect, it } from "vitest";

// MIGRATION_DB is a separate, unmigrated database: test/setup.ts migrates
// env.DB fully, which hides the pre-0020 schema this test needs to seed.
const db = env.MIGRATION_DB;
const before = env.MIGRATIONS.filter((m) => m.name < "0020");
const rename = env.MIGRATIONS.filter((m) => m.name.startsWith("0020"));

const all = async <T>(sql: string, ...params: unknown[]) =>
  (await db.prepare(sql).bind(...params).all<T>()).results;
const count = async (table: string) =>
  (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

const orgName = /(^|_)org(_|$)/;
const triggers = [
  "project_seed_task_types",
  "task_fill_default_type",
  "task_fill_default_reporter",
  "task_parent_check_insert",
  "task_parent_check_update",
];

it("0020 renames org to team in place, keeping data, keys and triggers", async () => {
  expect(rename).toHaveLength(1);
  await applyD1Migrations(db, before);

  const t = 1_700_000_000_000;
  await db.batch([
    db.prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES
        ('u-owner', 'Owner', 'owner@m.test', 1, ${t}, ${t}),
        ('u-member', 'Member', 'member@m.test', 1, ${t}, ${t})`,
    ),
    db.prepare(`INSERT INTO org (id, slug, name, created_at) VALUES ('o1', 'acme', 'Acme', ${t})`),
    db.prepare(
      `INSERT INTO org_member (org_id, user_id, role, created_at) VALUES
        ('o1', 'u-owner', 'owner', ${t}), ('o1', 'u-member', 'member', ${t})`,
    ),
    db.prepare(
      `INSERT INTO org_invite (org_id, email, role, invited_by_user_id, created_at)
        VALUES ('o1', 'new@m.test', 'member', 'u-owner', ${t})`,
    ),
    db.prepare(
      `INSERT INTO org_reporting_line (org_id, user_id, lead_user_id) VALUES ('o1', 'u-member', 'u-owner')`,
    ),
    db.prepare(
      `INSERT INTO project (id, org_id, slug, name, key, created_at) VALUES ('p1', 'o1', 'web', 'Web', 'WEB', ${t})`,
    ),
    db.prepare(
      `INSERT INTO status (id, project_id, name, position, created_at, color) VALUES ('s1', 'p1', 'Todo', 'a0', ${t}, 'gray')`,
    ),
    db.prepare(
      `INSERT INTO project_member (org_id, project_id, user_id, role) VALUES ('o1', 'p1', 'u-member', 'admin')`,
    ),
    db.prepare(
      `INSERT INTO project_slug_alias (org_id, slug, project_id, created_at) VALUES ('o1', 'old-web', 'p1', ${t})`,
    ),
    db.prepare(
      `INSERT INTO task (id, project_id, number, title, status_id, position, created_by_user_id, created_at, updated_at)
        VALUES ('t1', 'p1', 1, 'First', 's1', 'a0', 'u-member', ${t}, ${t})`,
    ),
    db.prepare(
      `INSERT INTO time_entry (id, org_id, task_id, user_id, started_at, ended_at, kind, source, created_at, updated_at)
        VALUES ('te1', 'o1', 't1', 'u-member', ${t}, ${t + 3_600_000}, 'manual', 'web', ${t}, ${t})`,
    ),
    db.prepare(
      `INSERT INTO mail_outbox (id, kind, target_id, recipient, ready_at) VALUES
        ('m1', 'org_invite', 'o1', 'new@m.test', ${t}),
        ('m2', 'comment_mention', 'c1', 'member@m.test', ${t})`,
    ),
  ]);
  // The 0007 trigger seeded the starter types for p1.
  expect(await count("project_task_type")).toBe(4);

  await applyD1Migrations(db, rename);

  // No table, index, trigger or column keeps an org name.
  const objects = await all<{ type: string; name: string }>(
    `SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND substr(name, 1, 4) <> '_cf_'`,
  );
  expect(objects.filter((o) => orgName.test(o.name))).toEqual([]);
  const columns = await all<{ tbl: string; name: string }>(
    `SELECT m.name AS tbl, c.name FROM sqlite_master m, pragma_table_info(m.name) c
      WHERE m.type = 'table' AND substr(m.name, 1, 4) <> '_cf_'`,
  );
  expect(columns.length).toBeGreaterThan(0);
  expect(columns.filter((c) => orgName.test(c.name))).toEqual([]);

  const names = new Set(objects.map((o) => o.name));
  for (const name of [
    "team",
    "team_member",
    "team_invite",
    "team_reporting_line",
    "team_slug_unique",
    "team_member_team_id_user_id_unique",
    "team_invite_team_id_email_unique",
    "team_invite_email_idx",
    "team_reporting_line_team_user_unique",
    "team_reporting_line_team_lead_idx",
    "project_team_id_slug_unique",
    "project_team_id_key_unique",
    "time_entry_team_id_started_at_idx",
    ...triggers,
  ]) {
    expect(names, name).toContain(name);
  }

  // Seeded rows survive under the new names with the same ids.
  expect(await all("SELECT id, slug, name FROM team")).toEqual([
    { id: "o1", slug: "acme", name: "Acme" },
  ]);
  expect(await all("SELECT team_id, user_id, role FROM team_member ORDER BY user_id")).toEqual([
    { team_id: "o1", user_id: "u-member", role: "member" },
    { team_id: "o1", user_id: "u-owner", role: "owner" },
  ]);
  expect(await all("SELECT team_id, email FROM team_invite")).toEqual([
    { team_id: "o1", email: "new@m.test" },
  ]);
  expect(await all("SELECT team_id, user_id, lead_user_id FROM team_reporting_line")).toEqual([
    { team_id: "o1", user_id: "u-member", lead_user_id: "u-owner" },
  ]);
  expect(await all("SELECT id, team_id, slug, key FROM project")).toEqual([
    { id: "p1", team_id: "o1", slug: "web", key: "WEB" },
  ]);
  expect(await all("SELECT team_id, project_id, user_id, role FROM project_member")).toEqual([
    { team_id: "o1", project_id: "p1", user_id: "u-member", role: "admin" },
  ]);
  expect(await all("SELECT team_id, slug, project_id FROM project_slug_alias")).toEqual([
    { team_id: "o1", slug: "old-web", project_id: "p1" },
  ]);
  expect(await all("SELECT id, team_id, task_id FROM time_entry")).toEqual([
    { id: "te1", team_id: "o1", task_id: "t1" },
  ]);
  expect(
    await all("SELECT id, type_id, reporter_user_id FROM task"),
  ).toEqual([{ id: "t1", type_id: "p1:type:task", reporter_user_id: "u-member" }]);
  expect(await all("SELECT id, kind, target_id FROM mail_outbox ORDER BY id")).toEqual([
    { id: "m1", kind: "team_invite", target_id: "o1" },
    { id: "m2", kind: "comment_mention", target_id: "c1" },
  ]);

  expect(await all("PRAGMA foreign_key_check")).toEqual([]);

  // Triggers still fire against the renamed tables.
  await db
    .prepare(`INSERT INTO project (id, team_id, slug, name, key, created_at) VALUES ('p2', 'o1', 'api', 'API', 'API', ${t})`)
    .run();
  expect(await count("project_task_type WHERE project_id = 'p2'")).toBe(4);
  await db
    .prepare(
      `INSERT INTO task (id, project_id, number, title, status_id, position, created_by_user_id, created_at, updated_at)
        VALUES ('t2', 'p1', 2, 'Second', 's1', 'a1', 'u-owner', ${t}, ${t})`,
    )
    .run();
  expect(await all("SELECT type_id, reporter_user_id FROM task WHERE id = 't2'")).toEqual([
    { type_id: "p1:type:task", reporter_user_id: "u-owner" },
  ]);
  await expect(
    db
      .prepare(
        `INSERT INTO task (id, project_id, number, title, status_id, position, created_by_user_id, created_at, updated_at, parent_task_id)
          VALUES ('t3', 'p2', 1, 'Wrong project', 's1', 'a2', 'u-owner', ${t}, ${t}, 't1')`,
      )
      .run(),
  ).rejects.toThrow(/task_parent_invalid/);
  await expect(
    db.prepare("UPDATE task SET parent_task_id = 't2' WHERE id = 't2'").run(),
  ).rejects.toThrow(/task_parent_invalid/);

  // The composite FK to team_member still holds and still cascades.
  await expect(
    db
      .prepare(`INSERT INTO project_member (team_id, project_id, user_id) VALUES ('o1', 'p1', 'system-automation')`)
      .run(),
  ).rejects.toThrow(/FOREIGN KEY/);
  await db.prepare("DELETE FROM team_member WHERE user_id = 'u-member'").run();
  expect(await count("project_member")).toBe(0);
  expect(await count("team_reporting_line")).toBe(0);
});

it("the fully migrated test database has the team schema", async () => {
  const row = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'team_member'",
  ).first();
  expect(row).toEqual({ name: "team_member" });
});
