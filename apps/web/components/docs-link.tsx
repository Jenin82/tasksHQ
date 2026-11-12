import Link from "next/link";

export function DocsLink({ current = false }: { current?: boolean }) {
  return (
    <Link
      href="/docs"
      aria-current={current ? "page" : undefined}
      className="shrink-0 rounded-sm px-2 py-1 text-sm text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      Docs
    </Link>
  );
}
