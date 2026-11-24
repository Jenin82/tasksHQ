import { asc, eq } from "drizzle-orm";
import { forbidden } from "next/navigation";
import { orgMember, reportingLine, user as userTable } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { getOrgContext } from "@/lib/org-context";
import { ReportingLines } from "./reporting-lines";

/** Only org owners and admins manage reporting lines, for every org member. */
export default async function ReportingLinesPage() {
  const { canManage } = await getOrgContext();
  if (!canManage) forbidden();
  const people = await db.select({
    userId: userTable.id,
    name: userTable.name,
    email: userTable.email,
    leadUserId: reportingLine.leadUserId,
  })
    .from(orgMember)
    .innerJoin(userTable, eq(userTable.id, orgMember.userId))
    .leftJoin(reportingLine, eq(reportingLine.userId, orgMember.userId))
    .orderBy(asc(userTable.name), asc(userTable.email));

  return <ReportingLines people={people} />;
}
