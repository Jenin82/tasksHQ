import Link from "next/link";
import { AccountMenu } from "@/components/account-menu";
import { ChangelogButton } from "@/components/changelog";
import { DocsLink } from "@/components/docs-link";
import { Mark } from "@/components/mark";
import { ThemeButton } from "@/components/theme-toggle";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getOrgContext } from "@/lib/org-context";
import { listUserTeams } from "@/lib/team-context";

// The org's own pages: the team shell without a current team, so the
// sidebar lists teams to go back to. Someone outside the org gets a 404.
export default async function OrgSettingsLayout({ children }: { children: React.ReactNode }) {
  const { user, org, role, canManage } = await getOrgContext();
  const teams = await listUserTeams(user.id);

  return (
    <WorkspaceShell
      org={{ canManage }}
      projects={[]}
      canManageWorkspace={false}
      teams={teams.map(({ slug, name, implicit }) => ({ slug, name, member: !implicit }))}
      hasReports={false}
      canViewTimeReports={false}
      header={
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-1.5 border-b border-border bg-background px-3 sm:gap-3 sm:px-6">
          <Link href="/" aria-label="All teams" className="shrink-0 rounded-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Mark className="size-4" />
          </Link>
          <span className="flex min-w-0 items-center gap-2 px-2 py-1">
            <span className="truncate">{org.name}</span>
            <span className="stutter hidden shrink-0 sm:inline">{role}</span>
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <DocsLink />
            <ChangelogButton />
            <ThemeButton size="icon" />
            <AccountMenu user={{ name: user.name, email: user.email, image: user.image }} />
          </div>
        </header>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
