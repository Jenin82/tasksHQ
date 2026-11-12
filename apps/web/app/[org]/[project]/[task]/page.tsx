import { env } from "cloudflare:workers";
import type { Metadata } from "next";
import {
  compactPreviewText,
  readPrivateTaskPreview,
  taskPreviewDescription,
  taskPreviewPath,
  taskPreviewSize,
  type TaskPreviewParams,
} from "@/lib/task-preview";
import { TaskDetailContent } from "./task-detail-content";
import { readTaskDetail } from "./task-detail-data";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<TaskPreviewParams> }): Promise<Metadata> {
  const route = await params;
  const task = await readPrivateTaskPreview(route);
  if (!task) return {};

  const url = new URL(taskPreviewPath(route, task.key), env.BETTER_AUTH_URL);
  const title = `${task.key} ${compactPreviewText(task.title, 140)}`;
  const description = taskPreviewDescription(task);
  const image = { url: `${url.href}/preview.png`, ...taskPreviewSize, alt: title };
  return {
    title,
    description,
    openGraph: { type: "website", siteName: "TasksHQ", title, description, url, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ org: string; project: string; task: string }>;
}) {
  const { org, project, task } = await params;
  const data = await readTaskDetail(org, project, task);
  return <TaskDetailContent data={data} />;
}
