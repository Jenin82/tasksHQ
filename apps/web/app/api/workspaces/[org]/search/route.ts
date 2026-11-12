import { and, asc, eq, isNull, sql, type SQLWrapper } from "drizzle-orm";
import { project, status, task } from "@tasks/core/schema";
import { db } from "@/lib/db";
import { getOrgContext } from "@/lib/org-context";

const limit = 10;
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org } = await getOrgContext(slug);
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100).toLowerCase();
  if (!query) return Response.json({ projects: [], tasks: [] }, { headers });

  const allowed = eq(project.orgId, org.id);
  const taskKey = sql<string>`${project.key} || '-' || ${task.number}`;
  const match = (key: SQLWrapper, title: SQLWrapper) =>
    sql`(instr(lower(${key}), ${query}) > 0 or instr(lower(${title}), ${query}) > 0)`;
  const rank = (key: SQLWrapper, title: SQLWrapper) => sql`case
    when lower(${key}) = ${query} then 0
    when instr(lower(${key}), ${query}) = 1 then 1
    when instr(lower(${title}), ${query}) = 1 then 2
    else 3 end`;

  const [projects, tasks] = await Promise.all([
    db.select({ key: project.key, title: project.name, slug: project.slug })
      .from(project)
      .where(and(allowed, match(project.key, project.name)))
      .orderBy(rank(project.key, project.name), asc(project.name), asc(project.id))
      .limit(limit),
    db.select({
      key: taskKey,
      title: task.title,
      slug: project.slug,
      project: project.name,
      status: status.name,
      color: status.color,
    })
      .from(task)
      .innerJoin(project, eq(task.projectId, project.id))
      .innerJoin(status, and(eq(task.statusId, status.id), eq(status.projectId, project.id)))
      .where(and(allowed, isNull(task.archivedAt), match(taskKey, task.title)))
      .orderBy(rank(taskKey, task.title), asc(task.title), asc(task.id))
      .limit(limit),
  ]);

  return Response.json({
    projects: projects.map(({ slug: projectSlug, ...result }) => ({
      ...result, href: `/${org.slug}/${projectSlug}`,
    })),
    tasks: tasks.map(({ slug: projectSlug, ...result }) => ({
      ...result, href: `/${org.slug}/${projectSlug}/${result.key}`,
    })),
  }, { headers });
}
