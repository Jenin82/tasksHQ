import Link from "next/link";
import { getRunningTimer } from "@tasks/core/domain";
import { AccountMenu } from "@/components/account-menu";
import { ChangelogButton } from "@/components/changelog";
import { DocsLink } from "@/components/docs-link";
import { Mark } from "@/components/mark";
import { ThemeButton } from "@/components/theme-toggle";
import { RunningTimerChip } from "@/components/time-tracking";
import { WorkspaceShell } from "@/components/workspace-shell";
import { db } from "@/lib/db";
import { getOrgContext } from "@/lib/org-context";
import { roleLabel } from "@/lib/role-label";
import { listUserTeams } from "@/lib/team-context";

// The org's own pages: the team shell without a current team, so the
// sidebar lists teams to go back to. Someone outside the org gets a 404.
export default async function OrgSettingsLayout({ children }: { children: React.ReactNode }) {
  const { user, org, role, canManage } = await getOrgContext();
  const [teams, runningTimer] = await Promise.all([
    listUserTeams(user.id),
    getRunningTimer({ db, actorUserId: user.id, source: "web" }),
  ]);

  return (
    <WorkspaceShell
      org={{ canManage }}
      projects={[]}
      canManageWorkspace={false}
      teams={teams.map(({ slug, name, implicit }) => ({ slug, name, member: !implicit }))}
      header={
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-1.5 border-b border-border bg-background px-3 sm:gap-3 sm:px-6">
          <Link href="/" aria-label="All teams" className="shrink-0 rounded-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Mark className="size-4" />
          </Link>
          <span className="flex min-w-0 items-center gap-2 px-2 py-1">
            <span className="truncate">{org.name}</span>
            <span className="stutter hidden shrink-0 sm:inline">{roleLabel(role)}</span>
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {runningTimer && <RunningTimerChip timer={runningTimer} />}
            {/* As in the team top bar, a running timer takes the place of Docs and What's new on narrow screens. */}
            <div className={runningTimer ? "hidden lg:contents" : "contents"}>
              <DocsLink />
              <ChangelogButton />
            </div>
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
