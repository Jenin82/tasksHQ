"use client";

import { useContext, useLayoutEffect, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { SlidersHorizontal } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ProjectTabSkeleton } from "./project-tab-skeleton";
import { ProjectFiltersContext, ProjectFilterSlot, type FilterView } from "./project-filters-context";
import { WorkspaceNavigationToggle } from "./workspace-navigation";
import { useSavedTaskFilters } from "./use-saved-task-filters";
import { TaskTypeEditContext } from "@/app/[org]/[project]/table/inline-task-field";
import { AddWorkItemButton, type CreateTarget } from "./workspace-create";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

const views = [
  { id: "board", label: "Board" },
  { id: "table", label: "Table" },
] as const;

function viewPath(base: string, view: FilterView) {
  return view === "board" ? base : `${base}/${view}`;
}

export function ProjectTabFilters({ view, count, activeCount, children }: {
  view: FilterView;
  count?: number;
  activeCount?: number;
  children: React.ReactNode;
}) {
  const slot = useContext(ProjectFilterSlot);
  // The portal target is attached after hydration. Never emit inline markup
  // here, even if the layout's context is temporarily unavailable.
  return slot?.host && slot.view === view
    ? createPortal(
      <>
        {count !== undefined && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline" aria-label={`${count} work items`}>{count}</span>}
        <FilterToolbar view={view} activeCount={activeCount}>{children}</FilterToolbar>
      </>,
      slot.host,
    )
    : null;
}

export function FilterToolbar({ view, activeCount = 0, children }: {
  view: FilterView;
  activeCount?: number;
  children: React.ReactNode;
}) {
  const active = activeCount > 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline"
          className={cn("rounded-md", active ? "border-primary max-sm:px-2" : "max-sm:w-8 max-sm:px-0")}
          aria-label={view === "table" ? "Filters and sort" : "Filters"}
          aria-description={active ? `${activeCount} active ${activeCount === 1 ? "filter" : "filters"}` : undefined}>
          <SlidersHorizontal aria-hidden /> <span className="hidden sm:inline">Filters</span>
          {active && <span aria-hidden className="font-semibold tabular-nums text-primary">{activeCount}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={view === "table" ? "Work item filters and sort" : "Work item filters"}
        align="end"
        collisionPadding={12}
        className="w-[min(22rem,calc(100vw-1.5rem))] rounded-xl p-4"
      >
        <p className="mb-3 text-sm font-semibold">Filters</p>
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function ProjectTabs({ base, projectName, createTarget, currentUser, children }: {
  base: string;
  projectName?: string;
  createTarget?: CreateTarget;
  currentUser?: { id: string; displayName: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const navigationToggle = useContext(WorkspaceNavigationToggle);
  const [pending, setPending] = useState<FilterView | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const loading = pending && viewPath(base, pending) !== pathname ? pending : null;
  const activePath = loading ? viewPath(base, loading) : pathname;
  const filterView = pathname === base ? "board" : pathname === `${base}/table` ? "table" : null;
  const [filters, setFilters] = useSavedTaskFilters(
    filterView && currentUser ? JSON.stringify([currentUser.id, base, filterView]) : undefined,
    currentUser?.id,
  );
  const section = pathname === `${base}/settings` ? "Settings" : pathname === `${base}/archived` ? "Archive" : "Work items";

  return (
    <ProjectFiltersContext.Provider value={{ filters, setFilters, currentUser }}>
      <ProjectFilterSlot.Provider value={{ host, view: loading ? null : filterView }}>
        <div className="sticky top-14 z-30 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-background px-3 py-1.5 sm:px-5">
          {projectName && (
            <div className="flex min-w-0 basis-full items-center gap-2 xl:max-w-72 xl:basis-auto">
              {navigationToggle}
              <p className="min-w-0 truncate text-sm font-semibold">{projectName} <span className="font-normal text-muted-foreground">/ {section}</span></p>
            </div>
          )}
          {section === "Work items" && <nav aria-label="Project" className="flex shrink-0 gap-1 rounded-md bg-muted p-0.5">
            {views.map(({ id, label }) => {
              const href = viewPath(base, id);
              const exact = activePath === href;
              const onTask = id === "board" && activePath.startsWith(`${base}/`) &&
                /^[a-z][a-z0-9]*-\d+$/i.test(activePath.slice(base.length + 1));

              return (
                <Link
                  key={id}
                  href={href}
                  aria-current={exact ? "page" : onTask ? "true" : undefined}
                  onNavigate={(event) => { if (loading === id) event.preventDefault(); }}
                  className={cn(
                    "flex min-h-8 shrink-0 items-center rounded px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-3",
                    exact || onTask
                      ? "bg-background text-foreground shadow-subtle"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                  <LinkPending view={id} setPending={setPending} />
                </Link>
              );
            })}
          </nav>}
          <div className="ml-auto flex shrink-0 items-center gap-2 empty:hidden">
            <div ref={setHost} className="flex items-center gap-2 empty:hidden" />
            {filterView && createTarget && <AddWorkItemButton key={pathname} {...createTarget} />}
          </div>
        </div>

        {/* A cancelled navigation can reveal the current view with its state intact. */}
        <TaskTypeEditContext.Provider value={createTarget ? { boardHref: base, taskTypes: createTarget.taskTypes } : null}>
          <div className={loading ? "hidden" : "flex min-h-0 flex-1 flex-col"}>{children}</div>
        </TaskTypeEditContext.Provider>
        {loading && <ProjectTabSkeleton view={loading} />}
      </ProjectFilterSlot.Provider>
    </ProjectFiltersContext.Provider>
  );
}

function LinkPending({ view, setPending }: {
  view: FilterView;
  setPending: Dispatch<SetStateAction<FilterView | null>>;
}) {
  const { pending } = useLinkStatus();

  useLayoutEffect(() => {
    if (!pending) return;
    // Vinext resets superseded links on navigation, including browser history.
    setPending(view);
    return () => setPending((current) => current === view ? null : current);
  }, [pending, setPending, view]);

  return null;
}
