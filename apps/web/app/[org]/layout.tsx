import { and, asc, eq } from "drizzle-orm";
import { can, canProject } from "@tasks/core/access";
import { orgReportingLine, project, projectMember } from "@tasks/core/schema";
import { TopBar } from "@/components/top-bar";
import { WorkspaceShell } from "@/components/workspace-shell";
import { db } from "@/lib/db";
import { getOrgContext, listUserOrganizations } from "@/lib/org-context";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org: slug } = await params;
  const { org, member, user } = await getOrgContext(slug);

  const [orgs, projectRows, reports] = await Promise.all([
    listUserOrganizations(user.id),
    db.select({ slug: project.slug, name: project.name, key: project.key, role: projectMember.role })
      .from(project)
      .leftJoin(projectMember, and(
        eq(projectMember.projectId, project.id),
        eq(projectMember.orgId, org.id),
        eq(projectMember.userId, user.id),
        eq(projectMember.role, "admin"),
      ))
      .where(eq(project.orgId, org.id))
      .orderBy(asc(project.name)),
    db.select({ userId: orgReportingLine.userId })
      .from(orgReportingLine)
      .where(and(eq(orgReportingLine.orgId, org.id), eq(orgReportingLine.leadUserId, user.id)))
      .limit(1),
  ]);
  const projects = projectRows.map(({ role, ...item }) => ({
    ...item,
    canManageSettings: canProject(member.role, role, "project:manage_statuses"),
  }));

  return (
    <WorkspaceShell
      key={org.slug}
      org={org.slug}
      projects={projects}
      canManageWorkspace={can(member.role, "org:manage_members")}
      hasMultipleOrganizations={orgs.length > 1}
      hasReports={reports.length > 0}
      header={
        <TopBar
          org={{ slug: org.slug, name: org.name }}
          role={member.role}
          orgs={orgs.map(({ slug, name }) => ({ slug, name }))}
          projects={projects}
          user={{ name: user.name, email: user.email, image: user.image }}
        />
      }
    >
      {children}
    </WorkspaceShell>
  );
}
