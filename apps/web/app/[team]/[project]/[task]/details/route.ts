import { readTaskDetail, type TaskDetailData } from "../task-detail-data";

export const dynamic = "force-dynamic";

type JsonDates<T> = T extends Date
  ? string
  : T extends object
    ? { [Key in keyof T]: JsonDates<T[Key]> }
    : T;

export type TaskDetailPayload = JsonDates<TaskDetailData>;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ team: string; project: string; task: string }> },
) {
  const { team, project, task } = await params;
  const data = await readTaskDetail(team, project, task, false);

  // The activity renderer uses clientName. OAuth client IDs are internal.
  const detail = {
    ...data.detail,
    activity: data.detail.activity.map((entry) => ({ ...entry, clientId: null })),
  };

  return Response.json(
    { ...data, detail },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
