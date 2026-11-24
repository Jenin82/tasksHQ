import { applyD1Migrations, env } from "cloudflare:test";
import { expect, it } from "vitest";

// MIGRATION_DB is a separate, unmigrated database: test/setup.ts migrates
// env.DB fully, which hides the team owner role this test needs to seed.
const db = env.MIGRATION_DB;
const before = env.MIGRATIONS.filter((m) => m.name < "0023");
const after = env.MIGRATIONS.filter((m) => m.name >= "0023" && m.name < "0024");

const all = async <T>(sql: string) => (await db.prepare(sql).all<T>()).results;

it("0023 turns team owners into team admins and leaves other roles alone", async () => {
  expect(after.map((m) => m.name)).toEqual(["0023_team_admin_role.sql"]);
  await applyD1Migrations(db, before);

  const t = 1_700_000_000_000;
  await db.batch([
    db.prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ${["o", "a", "m"]
        .map((p) => `('${p}', '${p}', '${p}@m.test', 1, ${t}, ${t})`)
        .join(", ")}`,
    ),
    db.prepare(`INSERT INTO team (id, slug, name, created_at) VALUES ('t', 'alpha', 'Alpha', ${t})`),
    db.prepare(
      `INSERT INTO team_member (team_id, user_id, role, created_at) VALUES
        ('t', 'o', 'owner', ${t}), ('t', 'a', 'admin', ${t}), ('t', 'm', 'member', ${t})`,
    ),
    db.prepare(
      `INSERT INTO team_invite (team_id, email, role, invited_by_user_id, created_at) VALUES
        ('t', 'x@m.test', 'owner', 'o', ${t}), ('t', 'y@m.test', 'admin', 'o', ${t}),
        ('t', 'z@m.test', 'member', 'o', ${t})`,
    ),
    db.prepare("UPDATE org_member SET role = 'owner' WHERE user_id = 'o'"),
    db.prepare("UPDATE org_member SET role = 'admin' WHERE user_id = 'a'"),
  ]);
  const orgRoles = "SELECT user_id, role FROM org_member WHERE user_id IN ('o', 'a', 'm') ORDER BY user_id";
  const orgBefore = await all(orgRoles);
  expect(orgBefore).toEqual([
    { user_id: "a", role: "admin" },
    { user_id: "m", role: "member" },
    { user_id: "o", role: "owner" },
  ]);

  await applyD1Migrations(db, after);

  expect(await all("SELECT user_id, role FROM team_member ORDER BY user_id")).toEqual([
    { user_id: "a", role: "admin" },
    { user_id: "m", role: "member" },
    { user_id: "o", role: "admin" },
  ]);
  expect(await all("SELECT email, role FROM team_invite ORDER BY email")).toEqual([
    { email: "x@m.test", role: "admin" },
    { email: "y@m.test", role: "admin" },
    { email: "z@m.test", role: "member" },
  ]);
  expect(await all(orgRoles)).toEqual(orgBefore);
  expect(await all("PRAGMA foreign_key_check")).toEqual([]);
});
