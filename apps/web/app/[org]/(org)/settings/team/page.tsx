import { and, asc, eq } from "drizzle-orm";
import { forbidden } from "next/navigation";
import { can } from "@tasks/core/access";
import { orgMember, orgReportingLine, user as userTable } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { getOrgContext } from "@/lib/org-context";
import { ReportingLines } from "./reporting-lines";

export default async function ReportingLinesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  if (!can(member.role, "org:manage_members")) forbidden();

  const people = await db
    .select({
      userId: orgMember.userId,
      name: userTable.name,
      email: userTable.email,
      leadUserId: orgReportingLine.leadUserId,
    })
    .from(orgMember)
    .innerJoin(userTable, eq(userTable.id, orgMember.userId))
    .leftJoin(orgReportingLine, and(
      eq(orgReportingLine.orgId, orgMember.orgId),
      eq(orgReportingLine.userId, orgMember.userId),
    ))
    .where(eq(orgMember.orgId, org.id))
    .orderBy(asc(userTable.name), asc(userTable.email));

  return <ReportingLines orgSlug={org.slug} people={people} />;
}
