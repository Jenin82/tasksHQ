import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import {
  createOrg,
  createProject,
  inviteToOrg,
  listTasks,
  revokeOrgInvite,
} from "@tasks/core/domain";
import { orgInvite, orgMember, projectInvite, projectMember, user, verification } from "@tasks/core/schema";
import { createTasksAuth } from "@/lib/auth";

const db = drizzle(env.DB);
const issuer = "http://localhost:5173";
const owner = { db, source: "web" as const, actorUserId: "email-auth-owner" };
await db.insert(user).values({
  id: owner.actorUserId,
  name: "Workspace owner",
  email: "owner@email-auth.test",
  emailVerified: true,
});

function fixture(ipSuffix: number, allowlist?: string, { enabled = true, beforeSend }: {
  enabled?: boolean;
  beforeSend?: () => Promise<void>;
} = {}) {
  const messages: { to: string; text: string }[] = [];
  const auth = createTasksAuth({
    database: env.DB,
    baseURL: issuer,
    secret: env.BETTER_AUTH_SECRET,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    signupEmailAllowlist: allowlist,
    sendMail: enabled ? async (message) => {
      await beforeSend?.();
      messages.push(message);
    } : undefined,
  });
  function post(path: string, body: Record<string, unknown>) {
    return auth.handler(new Request(`${issuer}/api/auth/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: issuer,
        "CF-Connecting-IP": `192.0.2.${ipSuffix}`,
      },
      body: JSON.stringify(body),
    }));
  }
  const send = (email: string) => post("email-otp/send-verification-otp", { email, type: "sign-in" });
  const verify = (email: string, otp: string, name?: string) =>
    post("sign-in/email-otp", { email, otp, name });
  async function issueCode(email: string) {
    expect((await send(email)).ok).toBe(true);
    const message = messages.findLast((message) => message.to === email.toLowerCase());
    const code = message?.text.match(/\b\d{6}\b/)?.[0];
    expect(code).toBeDefined();
    return code!;
  }
  return { auth, messages, send, verify, issueCode };
}

it("requires a name after email verification for a new account and consumes the code once", async () => {
  const email = "open-signup@email-auth.test";
  const flow = fixture(1);
  const code = await flow.issueCode(email);

  const needsName = await flow.verify(email, code);
  expect(needsName.ok).toBe(false);
  expect(await needsName.json()).toMatchObject({ code: "NAME_REQUIRED" });
  expect(await db.select().from(user).where(eq(user.email, email))).toEqual([]);

  const signedIn = await flow.verify(email, code, "  New Member  ");
  expect(signedIn.ok).toBe(true);
  expect(signedIn.headers.getSetCookie().length).toBeGreaterThan(0);
  expect(await signedIn.json()).toMatchObject({
    user: { name: "New Member", email, emailVerified: true },
  });
  expect((await flow.verify(email, code, "Another Name")).ok).toBe(false);
  expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(1);
});

it("matches exact domains and addresses at account creation and keeps existing accounts eligible", async () => {
  const flow = fixture(2, "  *@Allowed.Example, Test@gmail.com  ");
  const ctx = await flow.auth.$context;
  const googleSignup = (email: string) => ctx.internalAdapter.createUser(
    { name: "Google member", email, emailVerified: true },
    { method: "oauth", oauth: { providerId: "google" } },
  );
  expect(await googleSignup("New@ALLOWED.EXAMPLE")).toMatchObject({ email: "new@allowed.example" });
  expect(await googleSignup("test@gmail.com")).toMatchObject({ email: "test@gmail.com" });
  await expect(googleSignup("new@sub.allowed.example")).rejects.toThrow();
  await expect(googleSignup("other@gmail.com")).rejects.toThrow();

  const email = "existing@email-auth.test";
  await db.insert(user).values({
    id: "email-auth-existing",
    name: "Existing",
    email: "Existing@Email-Auth.Test",
    emailVerified: true,
  });
  const signedIn = await flow.verify(email, await flow.issueCode(email));
  expect(signedIn.ok).toBe(true);
  expect(await signedIn.json()).toMatchObject({ user: { id: "email-auth-existing", name: "Existing" } });
});

it("allows organization invitees outside the signup policy and gives members project access", async () => {
  const workspace = await createOrg(owner, { slug: "email-auth-invites", name: "Email invite checks" });
  const project = await createProject(owner, { orgId: workspace.id, slug: "deliveries", name: "Deliveries", key: "DEL" });
  const flow = fixture(3, "*@allowed.example");
  const workspaceEmail = "outside-workspace@email-auth.test";
  await inviteToOrg(owner, { orgId: workspace.id, email: workspaceEmail, role: "member" });

  const joinedWorkspace = await flow.verify(workspaceEmail, await flow.issueCode(workspaceEmail), "Org invitee");
  expect(joinedWorkspace.ok).toBe(true);
  const { user: orgUser } = await joinedWorkspace.json<{ user: { id: string } }>();
  expect(await db.select().from(orgMember).where(eq(orgMember.userId, orgUser.id)))
    .toEqual([expect.objectContaining({ orgId: workspace.id, role: "member" })]);
  expect(await db.select().from(projectMember).where(eq(projectMember.userId, orgUser.id))).toEqual([]);
  expect(await listTasks({ ...owner, actorUserId: orgUser.id }, { projectId: project.id })).toEqual([]);
});

it("ignores a legacy project invitation when checking the signup allowlist", async () => {
  const workspace = await createOrg(owner, { slug: "email-auth-legacy", name: "Legacy invitations" });
  const project = await createProject(owner, { orgId: workspace.id, slug: "legacy", name: "Legacy", key: "LEG" });
  const email = "outside-project@email-auth.test";
  await db.insert(projectInvite).values({
    projectId: project.id, email, invitedByUserId: owner.actorUserId, createdAt: new Date(),
  });

  const flow = fixture(15, "*@allowed.example");
  expect((await flow.send(email)).ok).toBe(true);
  expect(flow.messages).toEqual([]);
  expect(await db.select().from(user).where(eq(user.email, email))).toEqual([]);
});

it("rechecks an invite before allowing signup even if the code was already sent", async () => {
  const workspace = await createOrg(owner, { slug: "email-auth-revoked", name: "Revoked invites" });
  const flow = fixture(4, "*@allowed.example");
  const email = "revoked@email-auth.test";
  await inviteToOrg(owner, { orgId: workspace.id, email, role: "member" });
  const code = await flow.issueCode(email);
  await revokeOrgInvite(owner, { orgId: workspace.id, email });

  expect((await flow.verify(email, code, "Revoked invitee")).ok).toBe(false);
  expect(await db.select().from(user).where(eq(user.email, email))).toEqual([]);
});

it("does not use an accepted org invite to bypass the signup policy", async () => {
  const workspace = await createOrg(owner, { slug: "email-auth-accepted", name: "Accepted invites" });
  const email = "previous-invite@email-auth.test";
  await inviteToOrg(owner, { orgId: workspace.id, email, role: "member" });
  await db.update(orgInvite).set({ acceptedAt: new Date() })
    .where(and(eq(orgInvite.orgId, workspace.id), eq(orgInvite.email, email)));

  const flow = fixture(5, "*@allowed.example");
  await flow.send(email);
  expect(flow.messages).toEqual([]);
  expect(await db.select().from(user).where(eq(user.email, email))).toEqual([]);
});

it("lets a workspace owner revoke an owner invite and removes its signup bypass", async () => {
  const workspace = await createOrg(owner, { slug: "email-auth-org-revoke", name: "Revoked owner invite" });
  const admin = { ...owner, actorUserId: "email-auth-revoke-admin" };
  await db.insert(user).values({ id: admin.actorUserId, name: "Admin", email: "revoke-admin@email-auth.test" });
  await db.insert(orgMember).values({ orgId: workspace.id, userId: admin.actorUserId, role: "admin", createdAt: new Date() });

  const email = "invited-owner@email-auth.test";
  const invite = { orgId: workspace.id, email };
  await inviteToOrg(owner, { ...invite, role: "owner" });
  await revokeOrgInvite(admin, invite);
  const inviteRows = () => db.select().from(orgInvite).where(and(eq(orgInvite.orgId, workspace.id), eq(orgInvite.email, email)));
  expect(await inviteRows()).toEqual([expect.objectContaining({ role: "owner", acceptedAt: null })]);

  const flow = fixture(10, "*@allowed.example");
  const code = await flow.issueCode(email);
  await revokeOrgInvite(owner, { ...invite, email: ` ${email.toUpperCase()} ` });
  expect(await inviteRows()).toEqual([]);
  expect((await flow.verify(email, code, "Former invitee")).ok).toBe(false);
  expect(await db.select().from(user).where(eq(user.email, email))).toEqual([]);
});

it("disables both OTP endpoints without a sender, even for a code issued earlier", async () => {
  const email = "disabled@email-auth.test";
  const code = await fixture(6).issueCode(email);
  const disabled = fixture(7, undefined, { enabled: false });

  expect((await disabled.send("another-disabled@email-auth.test")).ok).toBe(false);
  expect((await disabled.verify(email, code, "Disabled signup")).ok).toBe(false);
  expect(await db.select().from(user).where(eq(user.email, email))).toEqual([]);
});

it("uses the same send cooldown for allowed and restricted addresses", async () => {
  const allowed = fixture(11, "*@allowed.example");
  const restricted = fixture(12, "*@allowed.example");
  const allowedEmail = "cooldown@allowed.example";
  const restrictedEmail = "cooldown@email-auth.test";

  const firstAllowed = await allowed.send(allowedEmail);
  const firstRestricted = await restricted.send(restrictedEmail);
  expect(firstAllowed.status).toBe(200);
  expect(firstRestricted.status).toBe(firstAllowed.status);
  expect(await firstRestricted.json()).toEqual(await firstAllowed.json());
  expect(allowed.messages).toHaveLength(1);
  expect(restricted.messages).toEqual([]);

  const repeatedAllowed = await allowed.send(allowedEmail);
  const repeatedRestricted = await restricted.send(restrictedEmail);
  expect(repeatedAllowed.status).toBe(429);
  expect(repeatedRestricted.status).toBe(repeatedAllowed.status);
  expect(await repeatedRestricted.json()).toEqual(await repeatedAllowed.json());
  expect(allowed.messages).toHaveLength(1);
  expect(restricted.messages).toEqual([]);
});

it("keeps the earlier OTP usable after an SMTP failure during resend", async () => {
  const email = "resend-failure@email-auth.test";
  const original = fixture(13);
  const code = await original.issueCode(email);
  // Simulate a resend after the cooldown but before the first code expires.
  await db.batch([
    db.update(verification).set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(verification.identifier, `tasks:otp-send:${email}`)),
    db.update(verification).set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(verification.identifier, `sign-in-otp-${email}`)),
  ]);
  const failing = fixture(14, undefined, {
    beforeSend: async () => { throw new Error("Simulated SMTP outage"); },
  });

  expect((await failing.send(email)).status).toBe(503);
  expect((await original.verify(email, code, "Original code holder")).ok).toBe(true);
});

it("rejects expired OTPs and throttles repeat sends to an address", async () => {
  const email = "expired@email-auth.test";
  const flow = fixture(8);
  const code = await flow.issueCode(email);

  const otherClient = fixture(9);
  await otherClient.send(email);
  expect(otherClient.messages).toEqual([]);
  expect(flow.messages).toHaveLength(1);
  await db.update(verification).set({ expiresAt: new Date(Date.now() - 1) })
    .where(eq(verification.identifier, `sign-in-otp-${email}`));
  expect((await flow.verify(email, code, "Expired code")).ok).toBe(false);
  expect(await db.select().from(user).where(eq(user.email, email))).toEqual([]);
});
