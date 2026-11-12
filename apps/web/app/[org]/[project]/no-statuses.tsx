/**
 * §16 lets the last status be deleted, so a project with no statuses at all is
 * reachable — and then both task views are empty for a reason that is not "no
 * tasks yet": none can be created either, because §18's `createTask` has
 * nowhere to put one. The board and the table say it in one voice, from here.
 */
export function NoStatuses({ canManage }: { canManage: boolean }) {
  return (
    <div className="px-10 py-16">
      <p className="text-base">This project has no statuses, so it can hold no tasks.</p>
      <p className="mt-2 text-base text-muted-foreground">
        {canManage
          ? "Add the first one under Settings. Every task lands in a status, so none can be created until one exists."
          : "An owner or an admin adds them under Settings. Every task lands in a status, so none can be created until one exists."}
      </p>
    </div>
  );
}
