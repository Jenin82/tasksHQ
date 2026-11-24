"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Archive, Briefcase, ChevronDown, ChevronRight, ChevronUp, Clock, Layers, LayoutGrid, ListTodo, Network, PanelLeft, Plus, Settings, Users } from "lucide-react";
import { NewTeamDialog } from "@/app/new-team-dialog";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { ProjectViewHref } from "./project-view-link";
import { ProjectTabSkeleton, TaskPageSkeleton } from "./project-tab-skeleton";
import { WorkspaceSearchPending, type SearchDestination } from "./workspace-search-navigation";
import { WorkspaceNavigationToggle } from "./workspace-navigation";

type Project = { slug: string; name: string; key: string; canManageSettings: boolean };

const projectSettingsPages = [
  ["General", ""],
  ["Workflow", "/workflow"],
  ["Admins", "/admins"],
  ["Integrations", "/integrations"],
] as const;

// Teams shown before "Show more".
const TEAM_LIMIT = 3;
const SECTIONS_KEY = "tasks:sidebar-closed-sections";
const COLLAPSED_KEY = "tasks:sidebar-collapsed";

// The org's Settings section, for org owners and admins.
const orgPages = [
  ["Teams", "/settings/teams", LayoutGrid],
  ["Members", "/settings/members", Users],
  ["Reporting lines", "/settings/reporting-lines", Network],
  ["General", "/settings/general", Settings],
] as const;

export function WorkspaceShell({ team, org, projects, canManageWorkspace, teams, header, children }: {
  /** Absent on the org's own pages, which show no Workspace or Projects. */
  team?: string;
  /**
   * `canManage`: an org owner or admin, who gets the Settings section and New team.
   */
  org: { canManage: boolean };
  projects: Project[];
  canManageWorkspace: boolean;
  /** `member` is false for teams an org owner or admin opens without belonging to. */
  teams: { slug: string; name: string; member: boolean }[];
  header: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [searchPending, setSearchPending] = useState<SearchDestination | null>(null);
  const loading = searchPending?.href !== pathname ? searchPending?.view : undefined;
  const active = projects.find(({ slug }) => pathname === `/${team}/${slug}` || pathname.startsWith(`/${team}/${slug}/`));
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [lastViews, setLastViews] = useState<Record<string, "board" | "table">>({});
  // The org's own pages have no team, and so no project views to remember.
  const storageKey = team ? `tasks:project-views:${team}` : undefined;
  const workspaceSettings = `/${team}/settings`;
  // On the org's pages, All My Tasks opens from the first team the user belongs to.
  const allTasksTeam = team ?? teams.find((o) => o.member)?.slug;
  const allTasks = allTasksTeam ? `/${allTasksTeam}/settings/all-tasks` : undefined;
  const teamMembers = `${workspaceSettings}/members`;
  const teamGeneral = `${workspaceSettings}/general`;
  const inTeamSettings = [teamMembers, teamGeneral].includes(pathname);
  const multipleTeams = teams.length > 1;
  // All My Tasks spans only teams the user belongs to.
  const multipleMemberTeams = teams.filter((o) => o.member).length > 1;
  const [showAllTeams, setShowAllTeams] = useState(false);
  // Collapsed sidebar sections, remembered per browser across teams.
  const [closedSections, setClosedSections] = useState<Record<string, boolean>>({});
  // Exactly TEAM_LIMIT rows until Show more; the current team takes the last one when it falls past the limit.
  const visibleTeams = showAllTeams || teams.slice(0, TEAM_LIMIT).some((o) => o.slug === team)
    ? teams.slice(0, showAllTeams ? undefined : TEAM_LIMIT)
    : [...teams.slice(0, TEAM_LIMIT - 1), ...teams.filter((o) => o.slug === team)];

  // Workspace can't collapse over the page you're on: its settings sub-menu is the only way between those pages.
  // Likewise, Settings stays open on its own pages.

  // A layout effect, so a client remount (switching teams) never paints collapsed sections open first.
  useLayoutEffect(() => {
    try {
      const saved = parseClosedSections(localStorage.getItem(SECTIONS_KEY));
      if (saved) {
        setClosedSections(saved);
        setShowAllTeams(saved.allTeams);
      }
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "true");
    } catch {
      // Sections start open when browser storage is unavailable.
    }
  }, []);

  // Every collapse in the sidebar remembers its last state in this browser.
  function remember(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // The toggle still works for this page.
    }
  }

  function toggleSection(section: string) {
    const next = { ...closedSections, [section]: !closedSections[section] };
    setClosedSections(next);
    if (section === "allTeams") setShowAllTeams(next.allTeams);
    remember(SECTIONS_KEY, JSON.stringify(next));
  }

  useEffect(() => {
    if (!storageKey) return;
    const base = active ? `/${team}/${active.slug}` : "";
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || "{}");
      const stored = saved && typeof saved === "object" && !Array.isArray(saved)
        ? saved as Record<string, "board" | "table">
        : {};
      if (active && (pathname === base || pathname === `${base}/table`)) {
        stored[active.slug] = pathname === base ? "board" : "table";
        localStorage.setItem(storageKey, JSON.stringify(stored));
      }
      setLastViews(stored);
    } catch {
      // Navigation works even when browser storage is unavailable.
    }
  }, [active, team, pathname, storageKey]);

  function projectHref(base: string) {
    const slug = base.slice((team ?? "").length + 2);
    return lastViews[slug] === "table" ? `${base}/table` : base;
  }

  const showAllTasks = (multipleTeams || !team) && multipleMemberTeams && allTasks !== undefined;
  const nav = (onNavigate?: () => void) => (
    <nav aria-label="Workspace navigation" className="space-y-5 p-3">
      {/* The org-wide Time page and All My Tasks sit together above the sections. */}
      <div className="space-y-1">
        <SidebarLink href="/settings/time" current={pathname === "/settings/time"} onNavigate={onNavigate}>
          <Clock aria-hidden /> Time
        </SidebarLink>
        {showAllTasks && (
          <SidebarLink href={allTasks} current={pathname === allTasks} onNavigate={onNavigate}>
            <Layers aria-hidden /> All My Tasks
          </SidebarLink>
        )}
      </div>
      {org.canManage && (
        <div className="space-y-1">
          <SectionHeading label="Settings" open={!closedSections.settings} onToggle={() => toggleSection("settings")} />
          {!closedSections.settings && <div role="group" aria-label="Settings" className="space-y-1">
            {orgPages.map(([label, href, Icon]) => (
              <SidebarLink key={href} href={href} current={pathname === href} onNavigate={onNavigate}>
                <Icon aria-hidden /> {label}
              </SidebarLink>
            ))}
          </div>}
        </div>
      )}
      {/* The org's own pages have no current team, so they always list them. */}
      {(multipleTeams || !team) && (
        <>
          <div className="space-y-1">
            <SectionHeading label="Teams" open={!closedSections.teams} onToggle={() => toggleSection("teams")}>
              {org.canManage && <NewTeamDialog trigger={
                <Button type="button" size="icon-sm" variant="ghost" className={SECTION_BUTTON} aria-label="New team">
                  <Plus aria-hidden />
                </Button>
              } />}
            </SectionHeading>
            {!closedSections.teams && <div role="group" aria-label="Teams" className="space-y-1">
              {visibleTeams.map((o) => (
                // Highlighted, never current: the Workspace "Projects" link already marks `/${team}`.
                <SidebarLink key={o.slug} href={`/${o.slug}`} current={false} highlighted={o.slug === team} onNavigate={onNavigate}>
                  <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded bg-muted text-[10px] font-semibold">{Array.from(o.name).slice(0, 2).join("").toUpperCase()}</span>
                  <span className="truncate">{o.name}</span>
                  {o.slug === team && <span className="sr-only">(current team)</span>}
                </SidebarLink>
              ))}
              {teams.length > TEAM_LIMIT && (
                <button type="button" aria-expanded={showAllTeams} onClick={() => toggleSection("allTeams")}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5 [&_svg]:shrink-0">
                  {showAllTeams ? <><ChevronUp aria-hidden /> Show less</> : <><ChevronDown aria-hidden /> Show more</>}
                </button>
              )}
            </div>}
          </div>
        </>
      )}
      {team && <>
      <div className="space-y-1">
        <SectionHeading label="Workspace" open={!closedSections.workspace} onToggle={() => toggleSection("workspace")} />
        {!closedSections.workspace && <div className="space-y-1">
          <SidebarLink href={`/${team}`} current={pathname === `/${team}`} onNavigate={onNavigate}>
            <Briefcase aria-hidden /> Projects
          </SidebarLink>
          <SidebarLink href={`${workspaceSettings}/your-tasks`} current={pathname === `${workspaceSettings}/your-tasks`} onNavigate={onNavigate}>
            <ListTodo aria-hidden /> Your Tasks
          </SidebarLink>
          {canManageWorkspace && (
            <div>
              <SidebarLink href={teamMembers} current={false} onNavigate={onNavigate}>
                <Settings aria-hidden /> Team settings
              </SidebarLink>
              {inTeamSettings && (
                <div className="my-1 ml-4 space-y-0.5 border-l border-border pl-2" role="group" aria-label="Team settings">
                  <SidebarLink href={teamMembers} current={pathname === teamMembers} onNavigate={onNavigate}>
                    Members
                  </SidebarLink>
                  <SidebarLink href={teamGeneral} current={pathname === teamGeneral} onNavigate={onNavigate}>
                    General
                  </SidebarLink>
                </div>
              )}
            </div>
          )}
        </div>}
      </div>
      <div className="space-y-1">
        <p className="px-2 text-xs font-semibold text-muted-foreground">Projects</p>
        {projects.map((project) => {
          const base = `/${team}/${project.slug}`;
          const items = projectHref(base);
          const selected = active?.slug === project.slug;
          return (
            <div key={project.slug}>
              <SidebarLink href={items} current={false} onNavigate={onNavigate}>
                <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded bg-muted text-[10px] font-semibold">{project.key.slice(0, 2)}</span>
                <span className="truncate">{project.name}</span>
              </SidebarLink>
              {selected && <div className="my-1 ml-4 space-y-0.5 border-l border-border pl-2">
                <SidebarLink href={items} current={pathname === base || pathname === `${base}/table`} onNavigate={onNavigate}><ListTodo aria-hidden /> Work items</SidebarLink>
                {project.canManageSettings && (
                  <div>
                    {/* Every project settings path shows the sub-menu, so the parent is never the current page. */}
                    <SidebarLink href={`${base}/settings`} current={false} onNavigate={onNavigate}><Settings aria-hidden /> Settings</SidebarLink>
                    {(pathname === `${base}/settings` || pathname.startsWith(`${base}/settings/`)) && (
                      <div className="my-1 ml-4 space-y-0.5 border-l border-border pl-2" role="group" aria-label="Project settings">
                        {projectSettingsPages.map(([label, path]) => {
                          const href = `${base}/settings${path}`;
                          return (
                            <SidebarLink key={label} href={href} current={pathname === href} onNavigate={onNavigate}>
                              {label}
                            </SidebarLink>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                <SidebarLink href={`${base}/archived`} current={pathname === `${base}/archived`} onNavigate={onNavigate}><Archive aria-hidden /> Archive</SidebarLink>
              </div>}
            </div>
          );
        })}
      </div>
      </>}
    </nav>
  );

  const navigationToggle = (
    <>
      <Button type="button" size="icon" variant="ghost" className="hidden rounded-md md:inline-flex"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed}
        onClick={() => { setCollapsed(!collapsed); remember(COLLAPSED_KEY, String(!collapsed)); }}>
        <PanelLeft aria-hidden />
      </Button>
      <DialogTrigger asChild>
        <Button type="button" size="icon" variant="ghost" className="rounded-md md:hidden" aria-label="Open navigation">
          <PanelLeft aria-hidden />
        </Button>
      </DialogTrigger>
    </>
  );

  return (
    <ProjectViewHref.Provider value={projectHref}>
      <Dialog open={drawer} onOpenChange={setDrawer}>
        <div className="flex min-h-dvh flex-col bg-background">
          <WorkspaceSearchPending.Provider value={setSearchPending}>{header}</WorkspaceSearchPending.Provider>
          <div className="flex min-w-0 flex-1">
            {!collapsed && (
              <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 self-start overflow-y-auto border-r border-border bg-card md:block xl:w-64">
                {nav()}
              </aside>
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              {!active && <div className="px-3 py-1.5">{navigationToggle}</div>}
              <WorkspaceNavigationToggle.Provider value={navigationToggle}>
                <div className={loading ? "hidden" : "contents"}>{children}</div>
              </WorkspaceNavigationToggle.Provider>
              {loading && (
                <main className="flex min-h-0 flex-1 flex-col">
                  {loading === "task" ? <TaskPageSkeleton /> : <ProjectTabSkeleton view={loading} />}
                </main>
              )}
            </div>
          </div>
        </div>
        <DialogContent className="inset-y-0 left-0 flex w-[min(20rem,90vw)] max-w-none translate-x-0 translate-y-0 flex-col overflow-auto rounded-none bg-card p-0" aria-describedby={undefined}>
          <DialogTitle className="px-4 py-4 text-base">Navigation</DialogTitle>
          {nav(() => setDrawer(false))}
        </DialogContent>
      </Dialog>
    </ProjectViewHref.Provider>
  );
}

/** The saved `tasks:sidebar-closed-sections` value, keeping only known sections; null when it is not an object. */
export function parseClosedSections(raw: string | null): Record<string, boolean> | null {
  const saved: unknown = JSON.parse(raw || "{}");
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return null;
  const stored = saved as Record<string, unknown>;
  return {
    teams: stored.teams === true || stored.organizations === true,
    workspace: stored.workspace === true,
    settings: stored.settings === true,
    allTeams: stored.allTeams === true,
  };
}

const SECTION_BUTTON = "-my-1.5 rounded-md text-muted-foreground";

// A sidebar section label with its own actions and a collapse chevron at the far edge.
function SectionHeading({ label, open, onToggle, children }: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <p className="flex-1 px-2 text-xs font-semibold text-muted-foreground">{label}</p>
      {children}
      {/* Ghost buttons brighten while aria-expanded (meant for open menus); an open section stays muted until hover. */}
      <Button type="button" size="icon-sm" variant="ghost"
        className={cn(SECTION_BUTTON, "aria-expanded:text-muted-foreground aria-expanded:hover:text-foreground")}
        aria-label={`${open ? "Collapse" : "Expand"} ${label}`} aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
      </Button>
    </div>
  );
}

function SidebarLink({ href, current, highlighted = current, onNavigate, children }: {
  href: string;
  current: boolean;
  highlighted?: boolean;
  onNavigate?: () => void;
  children: ReactNode;
}) {
  return <Link
    href={href}
    aria-current={current ? "page" : undefined}
    onNavigate={onNavigate}
    className={cn("flex min-h-9 min-w-0 items-center gap-2 rounded-md px-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0", highlighted && "bg-muted font-medium")}
  >{children}</Link>;
}
