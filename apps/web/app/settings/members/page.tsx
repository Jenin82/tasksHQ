import { asc, desc, eq, isNull } from "drizzle-orm";
import { forbidden } from "next/navigation";
import { canOrg } from "@tasks/core/access";
import { orgInvite, orgMember, user as userTable } from "@tasks/core/schema";
import { orgRoleOptions } from "@/app/[team]/(team)/settings/members/role-select";
import { MemberInviteDialog } from "@/app/[team]/member-invite-dialog";
import { db } from "@/lib/db";
import { getOrgContext } from "@/lib/org-context";
import { roleLabel } from "@/lib/role-label";
import { emailEnabled } from "@/lib/smtp";
import { inviteOrgMemberAction } from "./actions";
import { OrgMemberControls, RevokeOrgInvite } from "./member-controls";

const date = (value: Date) => value.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function OrgMembersPage() {
  const { role } = await getOrgContext();
  if (!canOrg(role, "org:manage_members")) forbidden();

  const [members, invites] = await Promise.all([
    db.select({
      userId: orgMember.userId,
      role: orgMember.role,
      joinedAt: orgMember.createdAt,
      name: userTable.name,
      email: userTable.email,
    })
      .from(orgMember)
      .innerJoin(userTable, eq(userTable.id, orgMember.userId))
      .orderBy(asc(orgMember.createdAt), asc(orgMember.userId)),
    db.select({ email: orgInvite.email, role: orgInvite.role, invitedAt: orgInvite.createdAt })
      .from(orgInvite)
      .where(isNull(orgInvite.acceptedAt))
      .orderBy(desc(orgInvite.createdAt)),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-10 sm:py-12">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl">Members</h1>
          <span className="stutter numeral">{members.length}</span>
        </div>
        <MemberInviteDialog
          roleOptions={orgRoleOptions(role)}
          inviteAction={inviteOrgMemberAction}
          title="Invite to organization"
          description="The recipient joins the organization after signing in with the invited address. Add them to teams from each team's Members page."
        />
      </div>

      <ul className="mt-8 divide-y divide-border rounded-2xl bg-card px-6 shadow-subtle">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-6 py-3">
            <div className="min-w-0">
              <p className="truncate">{m.name}</p>
              <p className="truncate text-sm text-muted-foreground">{m.email}</p>
            </div>
            <div className="flex shrink-0 items-center gap-6">
              {/* An admin's authority stops short of a Super admin. */}
              {role === "owner" || m.role !== "owner" ? (
                <OrgMemberControls userId={m.userId} role={m.role} name={m.name} actorRole={role} />
              ) : (
                <span className="stutter">{roleLabel(m.role)}</span>
              )}
              <span className="stutter hidden sm:block">{date(m.joinedAt)}</span>
            </div>
          </li>
        ))}
      </ul>

      <section className="mt-12">
        <div className="flex items-baseline justify-between gap-6">
          <h2 className="text-xl">Pending invites</h2>
          <span className="stutter numeral">{invites.length}</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {emailEnabled
            ? "TasksHQ queues an email for new invites. Each invite is claimed when the recipient signs in with that address."
            : "Share the TasksHQ link with invitees. Each invite is claimed when the recipient signs in with that Google address."}
        </p>
        {invites.length === 0 ? (
          <p className="mt-6 text-base text-muted-foreground">No invites are waiting.</p>
        ) : (
          <ul className="mt-6 divide-y divide-border border-y border-border">
            {invites.map((i) => (
              <li key={i.email} className="flex items-baseline justify-between gap-6 py-3">
                <span className="truncate">{i.email}</span>
                <span className="flex shrink-0 items-baseline gap-6">
                  <span className="stutter">{roleLabel(i.role)}</span>
                  <span className="stutter hidden sm:block">{date(i.invitedAt)}</span>
                  {(role === "owner" || i.role !== "owner") && <RevokeOrgInvite email={i.email} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
