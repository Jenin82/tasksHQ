"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Archive, Briefcase, Layers, ListTodo, PanelLeft, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { ProjectViewHref } from "./project-view-link";
import { ProjectTabSkeleton, TaskPageSkeleton } from "./project-tab-skeleton";
import { WorkspaceSearchPending, type SearchDestination } from "./workspace-search-navigation";
import { WorkspaceNavigationToggle } from "./workspace-navigation";

type Project = { slug: string; name: string; key: string; canManageSettings: boolean };

export function WorkspaceShell({ org, projects, canManageWorkspace, hasReports, hasMultipleOrganizations, header, children }: {
  org: string;
  projects: Project[];
  canManageWorkspace: boolean;
  hasReports: boolean;
  hasMultipleOrganizations?: boolean;
  header: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [searchPending, setSearchPending] = useState<SearchDestination | null>(null);
  const loading = searchPending?.href !== pathname ? searchPending?.view : undefined;
  const active = projects.find(({ slug }) => pathname === `/${org}/${slug}` || pathname.startsWith(`/${org}/${slug}/`));
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [lastViews, setLastViews] = useState<Record<string, "board" | "table">>({});
  const storageKey = `tasks:project-views:${org}`;
  const workspaceSettings = `/${org}/settings`;
  const allTasks = `${workspaceSettings}/all-tasks`;
  const organizationMembers = `${workspaceSettings}/members`;
  const reportingLines = `${workspaceSettings}/team`;
  const organizationGeneral = `${workspaceSettings}/general`;
  const inOrganizationSettings = [organizationMembers, reportingLines, organizationGeneral].includes(pathname);

  useEffect(() => {
    const base = active ? `/${org}/${active.slug}` : "";
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
  }, [active, org, pathname, storageKey]);

  function projectHref(base: string) {
    const slug = base.slice(org.length + 2);
    return lastViews[slug] === "table" ? `${base}/table` : base;
  }

  const nav = (onNavigate?: () => void) => (
    <nav aria-label="Workspace projects" className="space-y-5 p-3">
      {hasMultipleOrganizations && (
        <SidebarLink href={allTasks} current={pathname === allTasks} onNavigate={onNavigate}>
          <Layers aria-hidden /> All My Tasks
        </SidebarLink>
      )}
      <div className="space-y-1">
        <p className="px-2 text-xs font-semibold text-muted-foreground">Workspace</p>
        <SidebarLink href={`/${org}`} current={pathname === `/${org}`} onNavigate={onNavigate}>
          <Briefcase aria-hidden /> Projects
        </SidebarLink>
        <SidebarLink href={`${workspaceSettings}/your-tasks`} current={pathname === `${workspaceSettings}/your-tasks`} onNavigate={onNavigate}>
          <ListTodo aria-hidden /> Your Tasks
        </SidebarLink>
        {hasReports && (
          <SidebarLink href={`${workspaceSettings}/your-team`} current={pathname === `${workspaceSettings}/your-team`} onNavigate={onNavigate}>
            <Users aria-hidden /> Your Team
          </SidebarLink>
        )}
        {canManageWorkspace && (
          <div>
            <SidebarLink href={organizationMembers} current={false} onNavigate={onNavigate}>
              <Settings aria-hidden /> Settings
            </SidebarLink>
            {inOrganizationSettings && (
              <div className="my-1 ml-4 space-y-0.5 border-l border-border pl-2" role="group" aria-label="Organization settings">
                <SidebarLink href={organizationMembers} current={pathname === organizationMembers} onNavigate={onNavigate}>
                  Members
                </SidebarLink>
                <SidebarLink href={reportingLines} current={pathname === reportingLines} onNavigate={onNavigate}>
                  Reporting lines
                </SidebarLink>
                <SidebarLink href={organizationGeneral} current={pathname === organizationGeneral} onNavigate={onNavigate}>
                  General
                </SidebarLink>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="space-y-1">
        <p className="px-2 text-xs font-semibold text-muted-foreground">Projects</p>
        {projects.map((project) => {
          const base = `/${org}/${project.slug}`;
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
                  <SidebarLink href={`${base}/settings`} current={pathname === `${base}/settings`} onNavigate={onNavigate}><Settings aria-hidden /> Settings</SidebarLink>
                )}
                <SidebarLink href={`${base}/archived`} current={pathname === `${base}/archived`} onNavigate={onNavigate}><Archive aria-hidden /> Archive</SidebarLink>
              </div>}
            </div>
          );
        })}
      </div>
    </nav>
  );

  const navigationToggle = (
    <>
      <Button type="button" size="icon" variant="ghost" className="hidden rounded-md md:inline-flex"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}>
        <PanelLeft aria-hidden />
      </Button>
      <DialogTrigger asChild>
        <Button type="button" size="icon" variant="ghost" className="rounded-md md:hidden" aria-label="Open projects">
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
          <DialogTitle className="px-4 py-4 text-base">Workspace</DialogTitle>
          {nav(() => setDrawer(false))}
        </DialogContent>
      </Dialog>
    </ProjectViewHref.Provider>
  );
}

function SidebarLink({ href, current, onNavigate, children }: {
  href: string;
  current: boolean;
  onNavigate?: () => void;
  children: ReactNode;
}) {
  return <Link
    href={href}
    aria-current={current ? "page" : undefined}
    onNavigate={onNavigate}
    className={cn("flex min-h-9 min-w-0 items-center gap-2 rounded-md px-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0", current && "bg-muted font-medium")}
  >{children}</Link>;
}
