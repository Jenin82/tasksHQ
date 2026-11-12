"use client";

import { useContext, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowUpRight, Check, ChevronsUpDown } from "lucide-react";
import { AccountMenu, type AccountUser } from "@/components/account-menu";
import { DocsLink } from "@/components/docs-link";
import { Mark } from "@/components/mark";
import { ThemeButton } from "@/components/theme-toggle";
import { ProjectViewHref } from "@/components/project-view-link";
import { WorkspaceSearch } from "@/components/workspace-search";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Crumb = { slug: string; name: string };

// A foreground wash keeps the muted role label legible in both themes.
const CRUMB_TARGET =
  "rounded-sm outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring";

/**
 * §7.2: the app's chrome is one opaque bar on the canvas. The server passes
 * what it already read — orgs, the reachable projects, the user — and the
 * project crumb appears only when the URL names one of those projects, so an
 * unreachable slug never shows a name.
 */
export function TopBar({
  org,
  role,
  orgs,
  projects,
  user,
}: {
  org: Crumb;
  role: string;
  orgs: Crumb[];
  projects: (Crumb & { key: string })[];
  user: AccountUser;
}) {
  const params = useParams<{ project?: string }>();
  const project = projects.find((p) => p.slug === params.project);

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-1.5 border-b border-border bg-background px-3 sm:gap-3 sm:px-6">
      <Link
        href="/"
        aria-label="All organizations"
        className="shrink-0 rounded-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Mark className="size-4" />
      </Link>

      {/* An org lands on its project page (`/[org]`, §26), never straight on a
          board: that page is where a project is picked and the only way
          into the org's settings. */}
      <Switcher
        label="Switch organization"
        triggerLabel={`Switch organization: ${org.name}`}
        current={org.slug}
        items={orgs.map((o) => ({ ...o, href: `/${o.slug}`, keywords: [o.name] }))}
        footer={{ label: "New organization", href: "/" }}
      >
        <span className="truncate">{org.name}</span>
        <span className="stutter hidden shrink-0 sm:inline">{role}</span>
      </Switcher>

      {project ? (
        <div className="hidden min-w-0 items-center gap-1.5 sm:flex md:hidden">
          <span aria-hidden className="text-muted-foreground">
            /
          </span>
          <ProjectSwitcher org={org} project={project} projects={projects} />
        </div>
      ) : null}

      <div className="ml-auto flex min-w-0 justify-center sm:flex-1">
        <WorkspaceSearch key={org.slug} org={org.slug} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <DocsLink />
        <ThemeButton size="icon" />
        <AccountMenu user={user} />
      </div>
    </header>
  );
}

function ProjectSwitcher({ org, project, projects }: {
  org: Crumb;
  project: Crumb & { key: string };
  projects: (Crumb & { key: string })[];
}) {
  const projectHref = useContext(ProjectViewHref);
  return (
    <Switcher
      label="Switch project"
      href={projectHref(`/${org.slug}/${project.slug}`)}
      current={project.slug}
      items={projects.map((p) => ({
        ...p,
        href: projectHref(`/${org.slug}/${p.slug}`),
        keywords: [p.name, p.key],
      }))}
      footer={{ label: "All projects", href: `/${org.slug}` }}
    >
      <span className="truncate">{project.name}</span>
      <span className="stutter hidden shrink-0 sm:inline">{project.key}</span>
    </Switcher>
  );
}

/**
 * The organization name and chevron share a trigger. The project name links
 * to its saved view. In either picker, type to filter, use arrows and Enter to pick,
 * Esc to close (Radix returns focus to the button). Items are keyed by
 * slug, the one unique identity, since two names can be the same; the name
 * (and a project's key) are what the search matches. The footer stays visible
 * whatever is typed, so its way out is never filtered away.
 */
function Switcher({
  label,
  triggerLabel = label,
  href,
  current,
  items,
  footer,
  children,
}: {
  label: string;
  triggerLabel?: string;
  href?: string;
  current: string;
  items: { slug: string; name: string; key?: string; href: string; keywords: string[] }[];
  footer: { label: string; href: string };
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex min-w-0 items-center gap-0.5">
        {href && <Link
          href={href}
          className={`flex min-w-0 items-center gap-2 px-2 py-1 ${CRUMB_TARGET}`}
        >
          {children}
        </Link>}
        <PopoverTrigger
          type="button"
          aria-label={triggerLabel}
          className={`cursor-pointer aria-expanded:bg-foreground/5 ${CRUMB_TARGET} ${href
            ? "grid size-8 shrink-0 place-items-center text-muted-foreground"
            : "flex h-8 min-w-0 items-center gap-2 px-2"}`}
        >
          {!href && children}
          <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
      </div>
      <PopoverContent aria-label={label} className="w-70" collisionPadding={12}>
        {/* Opens with the current item highlighted. */}
        <Command label={label} defaultValue={current}>
          <CommandInput aria-label={label} placeholder="Search…" />
          <CommandList>
            <CommandEmpty>No matches</CommandEmpty>
            {items.map((item) => (
              <CommandItem
                key={item.slug}
                value={item.slug}
                keywords={item.keywords}
                aria-current={item.slug === current ? "page" : undefined}
                onSelect={() => go(item.href)}
              >
                <span className="flex-1 truncate">{item.name}</span>
                {item.key && <span className="stutter shrink-0 text-popover-foreground/70!">{item.key}</span>}
                {item.slug === current ? <Check aria-hidden className="size-3.5" /> : null}
              </CommandItem>
            ))}
            <CommandSeparator alwaysRender />
            {/* A label with a space and capitals cannot collide with a slug. */}
            <CommandItem value={footer.label} forceMount onSelect={() => go(footer.href)}>
              <span className="flex-1">{footer.label}</span>
              <ArrowUpRight aria-hidden className="size-3.5 text-popover-foreground/70" />
            </CommandItem>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
