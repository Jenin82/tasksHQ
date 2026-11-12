import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { DocsFrame } from "./guide";
import { LegacyMcpLink } from "./legacy-mcp-link";
import { guideGroups, guideHref, guideTopics } from "./topics";

export const metadata: Metadata = {
  title: "Product documentation · TasksHQ",
  description: "Learn how to set up projects, track work, manage your organization, and connect integrations in TasksHQ.",
  alternates: { canonical: "/docs" },
};

export default function DocsPage() {
  return (
    <DocsFrame>
      <LegacyMcpLink />
      <div className="max-w-[54rem]">
        <p className="stutter">Product documentation</p>
        <h1 className="mt-3 text-4xl tracking-[-0.045em] sm:text-[3.5rem] sm:leading-tight">Learn to use TasksHQ</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
          Set up your first board, find the work that needs you, and configure TasksHQ for your team.
        </p>
        <div className="mt-10 space-y-9">
          {guideGroups.map((group) => (
            <section key={group} aria-label={group}>
              <h2 className="mb-3 text-lg tracking-tight">{group}</h2>
              <ul className="divide-y divide-border border-y border-border">
                {guideTopics.filter((topic) => topic.group === group).map(({ id, title, description }) => (
                  <li key={id}>
                    <Link href={guideHref(id)} className="group flex items-start justify-between gap-4 rounded-sm px-2 py-3.5 outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring sm:px-3">
                      <div className="min-w-0">
                        <h3 className="font-medium">{title}</h3>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
                      </div>
                      <ArrowUpRight aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </DocsFrame>
  );
}
