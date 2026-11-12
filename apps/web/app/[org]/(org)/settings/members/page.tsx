import { and, asc, desc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { can } from "@tasks/core/access";
import { orgInvite, orgMember, user as userTable } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { getOrgContext } from "@/lib/org-context";
import { emailEnabled } from "@/lib/smtp";
import { MemberInviteDialog } from "../../../member-invite-dialog";
import { inviteMemberAction } from "./actions";
import { MemberControls, RevokeMemberInvite } from "./member-controls";

const date = (value: Date) =>
  value.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export default async function MembersPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);

  if (!can(member.role, "org:manage_members")) forbidden();

  const members = await db
    .select({
      userId: orgMember.userId,
      role: orgMember.role,
      joinedAt: orgMember.createdAt,
      name: userTable.name,
      email: userTable.email,
    })
    .from(orgMember)
    .innerJoin(userTable, eq(userTable.id, orgMember.userId))
    .where(eq(orgMember.orgId, org.id))
    .orderBy(asc(orgMember.createdAt));

  const invites = await db
    .select({
      email: orgInvite.email,
      role: orgInvite.role,
      invitedAt: orgInvite.createdAt,
    })
    .from(orgInvite)
    .where(and(eq(orgInvite.orgId, org.id), isNull(orgInvite.acceptedAt)))
    .orderBy(desc(orgInvite.createdAt));

  return (
    <main className="mx-auto w-full max-w-3xl px-10 py-12">
      {/* The org has no tab row (§26): settings are reached from `/[org]`,
          so this is the way back. Calm register, muted until hovered. */}
      <Link
        href={`/${org.slug}`}
        className="rounded-sm text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        ← Projects
      </Link>
      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl">Members</h1>
          <span className="stutter numeral">{members.length}</span>
        </div>
        <MemberInviteDialog
          orgSlug={org.slug}
          actorRole={member.role}
          inviteAction={inviteMemberAction}
        />
      </div>

      <ul className="mt-8 divide-y divide-border rounded-2xl bg-card px-6 shadow-subtle">
        {members.map((m) => (
          <li
            key={m.userId}
            className="flex items-center justify-between gap-6 py-3"
          >
            <div className="min-w-0">
              <p className="truncate">{m.name}</p>
              <p className="truncate text-sm text-muted-foreground">
                {m.email}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-6">
              {/* §3: an admin's authority stops short of an owner. */}
              {member.role === "owner" || m.role !== "owner" ? (
                <MemberControls
                  orgSlug={org.slug}
                  userId={m.userId}
                  role={m.role}
                  name={m.name}
                  actorRole={member.role}
                />
              ) : (
                <span className="stutter">{m.role}</span>
              )}
              <span className="stutter hidden sm:block">
                {date(m.joinedAt)}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {members.length === 1 ? (
        <p className="mt-4 text-base text-muted-foreground">
          You are the only member so far.
        </p>
      ) : null}

      <section className="mt-12">
        <div className="flex items-baseline justify-between gap-6">
          <h2 className="text-xl">
            Pending invites
          </h2>
          <span className="stutter numeral">{invites.length}</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {emailEnabled
            ? "TasksHQ queues an email for new invites. Each invite is claimed when the recipient signs in with that address."
            : "Share the TasksHQ link with invitees. Each invite is claimed when the recipient signs in with that Google address."}
        </p>

        {invites.length === 0 ? (
          <p className="mt-6 text-base text-muted-foreground">
            No invites are waiting.
          </p>
        ) : (
          <ul className="mt-6 divide-y divide-border border-y border-border">
            {invites.map((i) => (
              <li
                key={i.email}
                className="flex items-baseline justify-between gap-6 py-3"
              >
                <span className="truncate">{i.email}</span>
                <span className="flex shrink-0 items-baseline gap-6">
                  <span className="stutter">{i.role}</span>
                  <span className="stutter hidden sm:block">
                    {date(i.invitedAt)}
                  </span>
                  {(member.role === "owner" || i.role !== "owner") && (
                    <RevokeMemberInvite orgSlug={org.slug} email={i.email} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
