import { notFound } from "next/navigation";
import { AccessError } from "@tasks/core/access";
import { getTaskSummaryByKey, getTaskTimeTotals } from "@tasks/core/domain";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/project-context";

export const dynamic = "force-dynamic";

/** The task panel lists this many of the viewer's entries; Your Time has the rest. */
const LISTED = 10;

export type TaskTimePayload = {
  totalMs: number;
  mineMs: number;
  /** The viewer's running timer on this task, which may not be among `entries`. */
  runningSince: string | null;
  entries: { id: string; startedAt: string; endedAt: string | null; note: string | null; autoStopped: boolean; edited: boolean }[];
  more: boolean;
};

/** Read on demand by the task panel, never part of the list snapshot. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ org: string; project: string; task: string }> },
) {
  const { org, project: projectSlug, task: taskKey } = await params;
  const { user, project } = await getProjectContext(org, projectSlug);
  const ctx = { db, actorUserId: user.id, source: "web" as const };

  let totals: Awaited<ReturnType<typeof getTaskTimeTotals>>;
  try {
    const task = await getTaskSummaryByKey(ctx, { projectId: project.id, key: taskKey });
    totals = await getTaskTimeTotals(ctx, { taskId: task.id, projectId: project.id });
  } catch (error) {
    if (error instanceof AccessError && error.reason === "not_a_member") notFound();
    throw error;
  }

  const { totalMs, mineMs, myEntries } = totals;
  const payload: TaskTimePayload = {
    totalMs,
    mineMs,
    runningSince: myEntries.find((entry) => entry.endedAt === null)?.startedAt.toISOString() ?? null,
    entries: myEntries.slice(0, LISTED).map((entry) => ({
      id: entry.id,
      startedAt: entry.startedAt.toISOString(),
      endedAt: entry.endedAt?.toISOString() ?? null,
      note: entry.note,
      autoStopped: entry.autoStopped,
      edited: entry.editedAt !== null,
    })),
    more: myEntries.length > LISTED,
  };
  return Response.json(payload, { headers: { "Cache-Control": "private, no-store" } });
}
