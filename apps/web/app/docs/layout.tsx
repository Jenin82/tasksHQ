import type { ReactNode } from "react";
import Link from "next/link";
import { Mark } from "@/components/mark";
import { SiteFooter } from "@/components/site-footer";
import { ThemeButton } from "@/components/theme-toggle";
import { DocsSearch } from "./docs-search";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#guide-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:rounded-md focus:bg-background focus:p-2">
        Skip to guide content
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-2 px-4 sm:gap-3 sm:px-10">
          <Link href="/docs" aria-label="TasksHQ documentation" className="flex items-center gap-3 rounded-sm text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Mark className="size-4" />
            <span>TasksHQ</span>
            <span className="border-l border-border pl-3 text-muted-foreground">Docs</span>
          </Link>
          <DocsSearch />
          <Link href="/" className="shrink-0 whitespace-nowrap rounded-sm px-2 py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            Open TasksHQ
          </Link>
          <ThemeButton size="icon" />
        </div>
      </header>
      {children}
      <SiteFooter />
    </div>
  );
}
