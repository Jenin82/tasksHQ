import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";
import { ProjectTabs } from "@/components/tab-link";
import ArchivedLoading from "@/app/[org]/[project]/archived/loading";
import BoardLoading from "@/app/[org]/[project]/loading";
import SettingsLoading from "@/app/[org]/[project]/settings/loading";
import TableLoading from "@/app/[org]/[project]/table/loading";
import { useTaskPeopleFilters } from "@/app/[org]/[project]/task-people-filters";
import { readFilters } from "@/components/use-saved-task-filters";

const route = vi.hoisted(() => ({ pathname: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

it("shows Board and Table in the project tabs", () => {
  route.pathname = "/acme/web/table";
  const html = renderToStaticMarkup(<ProjectTabs base="/acme/web">Content</ProjectTabs>);
  expect([...html.matchAll(/<a\b[^>]*>([^<]+)<\/a>/g)].map((match) => match[1]))
    .toEqual(["Board", "Table"]);
  expect(html.match(/<a\b[^>]*>Table<\/a>/)?.[0]).toContain('aria-current="page"');
});

it.each([
  ["settings", "Settings"],
  ["archived", "Archive"],
])("hides project tabs on %s while keeping the section label", (path, label) => {
  route.pathname = `/acme/web/${path}`;
  const html = renderToStaticMarkup(<ProjectTabs base="/acme/web" projectName="Web">Content</ProjectTabs>);
  expect(html).not.toContain('aria-label="Project"');
  expect(html).toContain(`/ ${label}`);
  expect(html).toContain("Content");
});

it.each(["/acme/web", "/acme/web/table"])("shows all work items by default on %s", (pathname) => {
  route.pathname = pathname;
  const currentUser = { id: "me", displayName: "Me" };
  const other = { id: "other", displayName: "Other" };
  const type = { id: "task", name: "Task", color: "gray", icon: "task" } as const;

  function TaskList() {
    const filters = useTaskPeopleFilters([
      { key: "WEB-1", title: "My assignment", statusId: "todo", type, assignee: currentUser, createdBy: other, reportedBy: other },
      { key: "WEB-2", title: "Other assignment", statusId: "todo", type, assignee: other, createdBy: currentUser, reportedBy: currentUser },
      { key: "WEB-3", title: "Unassigned task", statusId: "todo", type, assignee: null, createdBy: currentUser, reportedBy: currentUser },
    ]);
    return <output>{filters.visible.map(({ key }) => key).join(", ")}</output>;
  }

  const html = renderToStaticMarkup(
    <ProjectTabs base="/acme/web" currentUser={currentUser}><TaskList /></ProjectTabs>,
  );
  expect(html).toContain("<output>WEB-1, WEB-2, WEB-3</output>");
});

it("loads saved filters from before reporters existed, and saved reporters after", () => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null });
  try {
    const old = { query: "bug", status: "", type: "", assignees: ["me"], creators: ["other"], assigneeDefaultsRemoved: true };
    stored.set("old", JSON.stringify(old));
    stored.set("new", JSON.stringify({ ...old, reporters: ["other", null] }));
    expect(readFilters("old")).toMatchObject({
      query: "bug", assignees: new Set(["me"]), creators: new Set(["other"]), reporters: new Set(),
    });
    expect(readFilters("new")?.reporters).toEqual(new Set(["other", null]));
  } finally {
    vi.unstubAllGlobals();
  }
});

it.each([
  ["board", BoardLoading],
  ["table", TableLoading],
  ["settings", SettingsLoading],
  ["archived", ArchivedLoading],
] as const)("provides a motion-safe loading state for %s", (view, Loading) => {
  const html = renderToStaticMarkup(<Loading />);
  expect(html).toContain(`data-project-loading="${view}"`);
  expect(html).toContain('role="status"');
  expect(html).toContain("motion-safe:after:animate-");
});
