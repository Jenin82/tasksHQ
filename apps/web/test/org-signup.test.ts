import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, expect, it } from "vitest";
import { orgInvite, orgMember, team, teamInvite, teamMember, user } from "@tasks/core/schema";
import { createTasksAuth } from "@/lib/auth";

// This file's storage starts with no org owner, which bootstrap needs.
const db = drizzle(env.DB);
const now = new Date();
const INVITER = "os-inviter";

await db.insert(user).values({ id: INVITER, name: INVITER, email: "inviter@org-signup.test", emailVerified: true, createdAt: now, updatedAt: now });
await db.insert(orgMember).values({ userId: INVITER, role: "admin", createdAt: now });
await db.insert(team).values({ id: "os-team", slug: "os-team", name: "OS", createdAt: now });
await db.insert(teamMember).values({ teamId: "os-team", userId: INVITER, role: "admin", createdAt: now });

beforeEach(async () => {
  await db.delete(orgMember).where(eq(orgMember.role, "owner"));
});

function authWith(options: { allowlist?: string; ownerEmail?: string }) {
  const auth = createTasksAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    signupEmailAllowlist: options.allowlist,
    ownerEmail: options.ownerEmail,
  });
  return {
    // Better Auth's Google sign-up seam, so lib/auth.ts's databaseHooks fire.
    async signUp(email: string, emailVerified = true) {
      const ctx = await auth.$context;
      return ctx.internalAdapter.createUser(
        { name: email, email, emailVerified },
        { method: "oauth", oauth: { providerId: "google" } },
      );
    },
    async signIn(userId: string) {
      const ctx = await auth.$context;
      return ctx.internalAdapter.createSession(userId);
    },
  };
}

const roleOf = async (userId: string) =>
  (await db.select().from(orgMember).where(eq(orgMember.userId, userId)))[0]?.role;

it("makes the verified owner email the org owner, outside the allowlist, only while there is none", async () => {
  const auth = authWith({ allowlist: "*@elsewhere.test", ownerEmail: " Boss@Org-Signup.test " });
  const boss = await auth.signUp("boss@org-signup.test");
  expect(await roleOf(boss.id)).toBe("owner");

  // Demoted later, a sign-in does not restore it while another owner exists.
  await db.insert(orgMember).values({ userId: INVITER, role: "owner", createdAt: now })
    .onConflictDoUpdate({ target: orgMember.userId, set: { role: "owner" } });
  await db.update(orgMember).set({ role: "member" }).where(eq(orgMember.userId, boss.id));
  await auth.signIn(boss.id);
  expect(await roleOf(boss.id)).toBe("member");
  await db.update(orgMember).set({ role: "admin" }).where(eq(orgMember.userId, INVITER));
});

it("bootstraps only a verified owner email", async () => {
  const auth = authWith({ ownerEmail: "late@org-signup.test" });
  await expect(auth.signUp("late@org-signup.test", false)).rejects.toThrow();

  // An existing unverified account is not promoted until it is verified.
  await db.insert(user).values({ id: "os-late", name: "Late", email: "Late@org-signup.test", emailVerified: false, createdAt: now, updatedAt: now });
  await auth.signIn("os-late");
  expect(await roleOf("os-late")).toBeUndefined();
  await db.update(user).set({ emailVerified: true }).where(eq(user.id, "os-late"));
  await auth.signIn("os-late");
  expect(await roleOf("os-late")).toBe("owner");
});

it("makes an allowlisted signup an org member with no teams", async () => {
  const created = await authWith({ allowlist: "*@open.test" }).signUp("someone@open.test");
  expect(await roleOf(created.id)).toBe("member");
  expect(await db.select().from(teamMember).where(eq(teamMember.userId, created.id))).toEqual([]);
  await expect(authWith({ allowlist: "*@open.test" }).signUp("someone@closed.test")).rejects.toThrow();
});

it("refuses uninvited signups when no allowlist is set", async () => {
  await expect(authWith({}).signUp("stranger@org-signup.test")).rejects.toThrow();
  expect(await db.select().from(user).where(eq(user.email, "stranger@org-signup.test"))).toEqual([]);
});

it("lets team and org invitees sign up without an allowlist", async () => {
  await db.insert(teamInvite).values({ teamId: "os-team", email: "teamed@org-signup.test", role: "member", invitedByUserId: INVITER, createdAt: now });
  const teamed = await authWith({}).signUp("teamed@org-signup.test");
  expect(await roleOf(teamed.id)).toBe("member");
  expect(await db.select().from(teamMember).where(eq(teamMember.userId, teamed.id))).toHaveLength(1);

  await db.insert(orgInvite).values({ email: "orged@org-signup.test", role: "admin", invitedByUserId: INVITER, createdAt: now });
  const orged = await authWith({}).signUp("orged@org-signup.test");
  expect(await roleOf(orged.id)).toBe("admin");
});
