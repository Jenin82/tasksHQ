import { cn } from "@/lib/utils";
import { Shimmer } from "@/components/ui/shimmer";

export type ProjectView = "board" | "table" | "settings" | "archived";

function BoardSkeleton() {
  return (
    <div aria-hidden className="grid auto-cols-[minmax(18rem,1fr)] grid-flow-col gap-6 overflow-hidden px-4 py-8 sm:px-10">
      {[0, 1, 2, 3].map((column) => (
        <div key={column} className={cn("space-y-2", column > 0 && "border-l border-border/70 pl-6")}>
          <div className="flex justify-between px-1 pb-3">
            <Shimmer className="h-3 w-24" />
            <Shimmer className="size-3" />
          </div>
          {[0, 1].map((row) => (
            <div key={row} className="space-y-2 rounded-xl bg-card px-3 py-2.5 shadow-subtle">
              <Shimmer className="h-2.5 w-12" />
              <Shimmer className={cn("h-4", row === 0 ? "w-4/5" : "w-2/3")} />
              <Shimmer className="h-2.5 w-14" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function TableSkeleton({ archived = false }: { archived?: boolean }) {
  return (
    <div aria-hidden className="overflow-hidden px-4 py-8 sm:px-10">
      {archived ? (
        <Shimmer className="mb-4 h-5 w-36" />
      ) : (
        <Shimmer className="mb-4 h-4 w-16" />
      )}
      <div className="min-w-96">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="grid grid-cols-[4rem_minmax(8rem,1fr)_6rem_6rem] items-center gap-4 border-b border-border/50 py-3">
            <Shimmer className="h-3 w-12" />
            <Shimmer className={cn("h-3.5", row % 2 ? "w-2/3" : "w-4/5")} />
            <Shimmer className="h-3 w-16" />
            <Shimmer className="h-3 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div aria-hidden className="mx-auto w-full max-w-3xl space-y-8 px-4 py-12 sm:px-10">
      {[4, 2].map((rows) => (
        <div key={rows} className="rounded-2xl bg-card p-6 shadow-subtle">
          <Shimmer className="h-5 w-24" />
          <Shimmer className="mt-3 h-3 w-3/4" />
          <div className="mt-6">
            {Array.from({ length: rows }, (_, row) => (
              <div key={row} className="flex items-center gap-4 border-t border-border py-3">
                <Shimmer className="size-7 shrink-0 rounded-full" />
                <Shimmer className="h-4 w-1/2" />
                <Shimmer className="ml-auto h-3 w-12" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const skeletons = {
  board: BoardSkeleton,
  table: TableSkeleton,
  settings: SettingsSkeleton,
  archived: () => <TableSkeleton archived />,
};

export function ProjectTabSkeleton({ view }: { view: ProjectView }) {
  const Skeleton = skeletons[view];

  return (
    <div data-project-loading={view} className="min-w-0 flex-1">
      <p role="status" className="sr-only">Loading {view}…</p>
      <Skeleton />
    </div>
  );
}

export function TaskPageSkeleton() {
  return (
    <div className="w-full min-w-0 px-4 py-8 sm:px-10 sm:py-12">
      <p role="status" className="sr-only">Loading task details…</p>
      <div aria-hidden className="space-y-6">
        <Shimmer className="h-3 w-16" />
        <Shimmer className="h-7 w-2/3 max-w-sm" />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="space-y-6">
            <Shimmer className="h-28 w-full" />
            <Shimmer className="h-12 w-full" />
          </div>
          <Shimmer className="h-44 w-full" />
        </div>
      </div>
    </div>
  );
}
