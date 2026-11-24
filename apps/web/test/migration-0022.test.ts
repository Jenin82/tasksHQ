import { applyD1Migrations, env } from "cloudflare:test";
import { expect, it } from "vitest";

// MIGRATION_DB is a separate, unmigrated database: test/setup.ts migrates
// env.DB fully, which hides the pre-0022 schema this test needs to seed.
const db = env.MIGRATION_DB;
// Seed before 0021 so the automation user can sit in a team without being an
// org member, as it does on a real upgrade.
const before = env.MIGRATIONS.filter((m) => m.name < "0021");
const after = env.MIGRATIONS.filter((m) => m.name >= "0021" && m.name < "0023");

const all = async <T>(sql: string, ...params: unknown[]) =>
  (await db.prepare(sql).bind(...params).all<T>()).results;
const lines = async () =>
  (await all<{ user_id: string; lead_user_id: string }>(
    "SELECT user_id, lead_user_id FROM reporting_line ORDER BY user_id",
  )).map((r) => `${r.user_id}>${r.lead_user_id}`);

it("0022 merges team reporting lines into one org-wide line per person", async () => {
  expect(after.map((m) => m.name)).toEqual(["0021_org_layer.sql", "0022_org_reporting_and_time.sql"]);
  await applyD1Migrations(db, before);

  const t = 1_700_000_000_000;
  const people = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
  await db.batch([
    db.prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ${people
        .map((p) => `('${p}', '${p}', '${p}@m.test', 1, ${t}, ${t})`)
        .join(", ")}`,
    ),
    // The oldest team wins by created_at, not by name.
    db.prepare(
      `INSERT INTO team (id, slug, name, created_at) VALUES
        ('t-new', 'alpha', 'Alpha', ${t + 1000}), ('t-old', 'zeta', 'Zeta', ${t})`,
    ),
    db.prepare(
      `INSERT INTO team_member (team_id, user_id, role, created_at) VALUES ${["t-old", "t-new"]
        .flatMap((team) => people.map((p) => `('${team}', '${p}', 'member', ${t})`))
        .join(", ")}, ('t-old', 'system-automation', 'member', ${t})`,
    ),
    db.prepare(
      `INSERT INTO team_reporting_line (team_id, user_id, lead_user_id) VALUES
        ('t-old', 'b', 'a'), ('t-new', 'b', 'c'),
        ('t-new', 'c', 'b'),
        ('t-old', 'd', 'd'),
        ('t-old', 'e', 'system-automation'), ('t-new', 'e', 'f'),
        ('t-old', 'system-automation', 'a'),
        ('t-old', 'g', 'h'), ('t-new', 'h', 'g'),
        ('t-old', 'i', 'j'), ('t-old', 'j', 'k'), ('t-new', 'k', 'i'),
        ('t-old', 'l', 'g')`,
    ),
  ]);

  await applyD1Migrations(db, after);

  // b keeps the oldest team's line (so b>c from Alpha is dropped and c>b
  // stands); the self-line and lines touching a non-member are skipped, so
  // e falls back to its newer team; the 2- and 3-cycles go, while l, which
  // only feeds into a cycle, keeps its line.
  expect(await lines()).toEqual(["b>a", "c>b", "e>f", "l>g"]);
  expect(await all("SELECT count(*) AS n FROM team_reporting_line")).toEqual([{ n: 13 }]);

  const indexes = (await all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index'")).map(
    (r) => r.name,
  );
  expect(indexes).toContain("reporting_line_lead_user_id_idx");
  expect(indexes).toContain("time_entry_started_at_idx");

  await expect(
    db.prepare(`INSERT INTO reporting_line (user_id, lead_user_id, created_at) VALUES ('d', 'd', ${t})`).run(),
  ).rejects.toThrow(/CHECK constraint failed/);

  // Leaving the org drops lines on both sides.
  await db.prepare("DELETE FROM org_member WHERE user_id = 'b'").run();
  expect(await lines()).toEqual(["e>f", "l>g"]);
  await db.prepare("DELETE FROM org_member WHERE user_id = 'f'").run();
  expect(await lines()).toEqual(["l>g"]);
  expect(await all("PRAGMA foreign_key_check")).toEqual([]);
});
