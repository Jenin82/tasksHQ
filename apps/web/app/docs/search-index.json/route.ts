import { isValidElement, type ReactNode } from "react";
import { sections as gettingStarted } from "../getting-started/content";
import type { GuideSection } from "../guide";
import { sections as integrations } from "../integrations/content";
import { sections as mcp } from "../mcp/content";
import { sections as organizationSettings } from "../organization-settings/content";
import { sections as projectSettings } from "../project-settings/content";
import type { DocsSearchEntry } from "../search";
import { guideHref, guideTopics, type GuideTopic } from "../topics";
import { sections as views } from "../views/content";
import { sections as workItems } from "../work-items/content";

const guideSections: Record<GuideTopic, GuideSection[]> = {
  "getting-started": gettingStarted,
  "work-items": workItems,
  views,
  "project-settings": projectSettings,
  "organization-settings": organizationSettings,
  integrations,
  mcp,
};

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

const entries: DocsSearchEntry[] = guideTopics.flatMap(({ id, title }) =>
  guideSections[id].map((section) => ({
    href: guideHref(id, section.id),
    guide: title,
    title: section.title,
    text: textOf(section.content).replace(/\s+/g, " ").replace(/ +([.,:;!?])/g, "$1").trim(),
    searchTerms: section.searchTerms,
  })),
);

export function GET() {
  return Response.json(entries, { headers: { "Cache-Control": "public, max-age=300" } });
}
