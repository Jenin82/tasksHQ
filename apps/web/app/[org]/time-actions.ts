"use server";

import { revalidatePath } from "next/cache";
import {
  createTimeEntry,
  deleteTimeEntry,
  getTaskSummaryByKey,
  setUserTimezone,
  startTimer,
  stopTimer,
  updateTimeEntry,
} from "@tasks/core/domain";
import { NO_ERROR, toActionState, type ActionState } from "@/lib/action-result";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/project-context";
import { requireUser } from "@/lib/session";

/** A task as the URL names it, so the task panel and the Your time picker address it the same way. */
export type TimeTaskTarget = { orgSlug: string; projectSlug: string; taskKey: string };

export type TaskTimeEntry = {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  note: string | null;
  autoStopped: boolean;
  edited: boolean;
};

const webContext = (actorUserId: string) => ({ db, actorUserId, source: "web" as const });

async function resolveTask({ orgSlug, projectSlug, taskKey }: TimeTaskTarget) {
  const { user, project } = await getProjectContext(orgSlug, projectSlug);
  const ctx = webContext(user.id);
  const task = await getTaskSummaryByKey(ctx, { projectId: project.id, key: taskKey });
  return { ctx, target: { taskId: task.id, projectId: project.id } };
}

async function userContext() {
  return webContext((await requireUser()).id);
}

/**
 * The running-timer chip sits in every organization's layout, and the timer
 * can belong to any of them, so every org subtree is refreshed.
 */
function revalidateTime() {
  revalidatePath("/[org]", "layout");
}

/**
 * Refreshes after a refusal too: "No timer is running." means another tab or
 * MCP already stopped it, and the chip should catch up. An AccessError still
 * becomes the 404/403 page, before any refresh.
 */
async function run(mutate: () => Promise<unknown>): Promise<ActionState> {
  let state = NO_ERROR;
  try {
    await mutate();
  } catch (error) {
    state = toActionState(error);
  }
  revalidateTime();
  return state;
}

/** Actions take input from any client, so values are coerced before the domain sees them. */
const toNote = (value: unknown) => (typeof value === "string" ? value : "");
const toDate = (value: unknown) => new Date(String(value));

export async function startTimerAction(input: TimeTaskTarget): Promise<ActionState> {
  return run(async () => {
    const { ctx, target } = await resolveTask(input);
    await startTimer(ctx, target);
  });
}

export async function stopTimerAction(): Promise<ActionState> {
  return run(async () => stopTimer(await userContext()));
}

/** Times arrive as ISO strings: the form converts what was typed in the zone it shows. */
export async function createTimeEntryAction(
  input: TimeTaskTarget,
  values: { startedAt: string; endedAt: string; note: string },
): Promise<ActionState> {
  return run(async () => {
    const { ctx, target } = await resolveTask(input);
    await createTimeEntry(ctx, {
      ...target,
      startedAt: toDate(values.startedAt),
      endedAt: toDate(values.endedAt),
      note: toNote(values.note),
    });
  });
}

/** A time left undefined keeps the stored one, so an untouched minute-precision field never shifts it. */
export async function updateTimeEntryAction(
  id: string,
  values: { startedAt?: string; endedAt?: string; note: string },
): Promise<ActionState> {
  return run(async () => updateTimeEntry(await userContext(), {
    id: String(id),
    startedAt: values.startedAt === undefined ? undefined : toDate(values.startedAt),
    endedAt: values.endedAt === undefined ? undefined : toDate(values.endedAt),
    note: toNote(values.note),
  }));
}

export async function deleteTimeEntryAction(id: string): Promise<ActionState> {
  return run(async () => deleteTimeEntry(await userContext(), { id: String(id) }));
}

export async function setTimezoneAction(timezone: string): Promise<ActionState> {
  try {
    await setUserTimezone(await userContext(), { timezone });
  } catch (error) {
    return toActionState(error);
  }
  revalidatePath("/[org]/settings/your-time", "page");
  return NO_ERROR;
}
