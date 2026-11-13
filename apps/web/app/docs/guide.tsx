import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { guideGroups, guideHref, guideTopics, type GuideTopic } from "./topics";

export type GuideSection = { id: string; title: string; content: ReactNode; searchTerms?: string[] };

const focus = "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const textLink = `${focus} underline underline-offset-4 decoration-border hover:decoration-current`;

export function guideMetadata(topic: GuideTopic): Metadata {
  const guide = guideTopics.find(({ id }) => id === topic)!;
  return { title: `${guide.title} · TasksHQ Docs`, description: guide.description, alternates: { canonical: guideHref(topic) } };
}

function TopicNavigation({ active }: { active?: GuideTopic }) {
  const link = (current: boolean) => `${focus} block px-2.5 py-1.5 text-sm hover:bg-muted hover:text-foreground ${current ? "bg-muted font-medium text-foreground" : "text-muted-foreground"}`;
  return (
    <nav aria-label="Documentation" className="space-y-5">
      <Link href="/docs" aria-current={active ? undefined : "page"} className={link(!active)}>Overview</Link>
      {guideGroups.map((group) => (
        <div key={group}>
          <p className="stutter px-2.5 pb-2">{group}</p>
          <ul className="space-y-0.5">
            {guideTopics.filter((topic) => topic.group === group).map(({ id, title }) => (
              <li key={id}>
                <Link href={guideHref(id)} aria-current={active === id ? "page" : undefined} className={link(active === id)}>{title}</Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Contents({ sections }: { sections: GuideSection[] }) {
  return (
    <nav aria-label="On this page">
      <ul className="space-y-2.5 text-sm">
        {sections.map(({ id, title }) => (
          <li key={id}><a href={`#${id}`} className={`${focus} text-muted-foreground hover:text-foreground`}>{title}</a></li>
        ))}
      </ul>
    </nav>
  );
}

export function DocsFrame({ active, sections, children }: { active?: GuideTopic; sections?: GuideSection[]; children: ReactNode }) {
  return (
    <div className={`mx-auto grid w-full max-w-[1280px] flex-1 items-start gap-x-10 gap-y-6 px-5 pt-6 pb-16 sm:px-10 lg:grid-cols-[11.5rem_minmax(0,1fr)] lg:pt-12 ${sections ? "xl:grid-cols-[11.5rem_minmax(0,1fr)_10rem]" : ""}`}>
      <aside className="min-w-0 lg:sticky lg:top-8">
        <div className="hidden lg:block"><TopicNavigation active={active} /></div>
        <details className="rounded-md border border-border lg:hidden">
          <summary className="cursor-pointer rounded-md px-3 py-2.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">Browse guides</summary>
          <div className="px-2 pt-2 pb-3"><TopicNavigation active={active} /></div>
        </details>
      </aside>
      <main id="guide-content" tabIndex={-1} className="min-w-0 outline-none">
        {children}
      </main>
      {sections && (
        <aside className="sticky top-8 hidden min-w-0 border-l border-border pl-4 xl:block">
          <p className="stutter mb-3">On this page</p>
          <Contents sections={sections} />
        </aside>
      )}
    </div>
  );
}

export function Guide({ topic, sections, intro }: { topic: GuideTopic; sections: GuideSection[]; intro?: ReactNode }) {
  const index = guideTopics.findIndex(({ id }) => id === topic);
  const { title, description, group } = guideTopics[index];
  const previous = guideTopics[index - 1];
  const next = guideTopics[index + 1];

  return (
    <DocsFrame active={topic} sections={sections}>
      <article className="max-w-[48rem]">
        <p className="stutter">{group}</p>
        <h1 className="mt-3 text-3xl tracking-[-0.045em] sm:text-5xl">{title}</h1>
        <p className="mt-4 max-w-[42rem] text-base leading-7 text-muted-foreground sm:text-lg">{description}</p>
        {intro && <div className="mt-6 space-y-4 text-base leading-7">{intro}</div>}
        <details className="mt-6 rounded-md border border-border xl:hidden">
          <summary className="cursor-pointer rounded-md px-3 py-2.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">On this page</summary>
          <div className="px-3 pt-2 pb-3"><Contents sections={sections} /></div>
        </details>
        <div className="mt-10 space-y-10">
          {sections.map(({ id, title: heading, content }) => (
            <section key={id} id={id} tabIndex={-1} aria-labelledby={`${id}-heading`} className="scroll-mt-6 border-t border-border pt-6 outline-none">
              <h2 id={`${id}-heading`} className="text-2xl tracking-tight">{heading}</h2>
              <div className="mt-4 space-y-4 text-base leading-7 [&_code]:break-words [&_code]:font-mono [&_code]:text-[0.875em] [&_strong]:font-medium">
                {content}
              </div>
            </section>
          ))}
        </div>
        <nav aria-label="Adjacent guides" className="mt-12 flex flex-wrap justify-between gap-4 border-t border-border pt-5 text-sm">
          <Link href={previous ? guideHref(previous.id) : "/docs"} className={textLink}>← {previous?.title ?? "Overview"}</Link>
          {next && <Link href={guideHref(next.id)} className={textLink}>{next.title} →</Link>}
        </nav>
      </article>
    </DocsFrame>
  );
}

export function DocLink({ topic, section, children }: { topic: GuideTopic; section?: string; children: ReactNode }) {
  return <Link href={guideHref(topic, section)} className={textLink}>{children}</Link>;
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-2.5 pl-6 marker:font-mono marker:text-muted-foreground">{children}</ol>;
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-border bg-card px-4 py-3 text-sm leading-6">{children}</div>;
}

export function CodeBlock({ children }: { children: string }) {
  return <pre tabIndex={0} className={`${focus} overflow-x-auto bg-muted p-4 text-sm leading-6`}><code>{children}</code></pre>;
}

const screenshotSizes = {
  board: [1280, 635],
  "task-detail": [1280, 770],
  "task-filters": [1024, 650],
  "project-statuses": [720, 467],
  "organization-members": [1280, 720],
} as const;

export function Screenshot({ name, alt, caption }: { name: keyof typeof screenshotSizes; alt: string; caption: string }) {
  const [width, height] = screenshotSizes[name];
  const src = `/docs-media/${name}.webp`;
  return (
    <figure className="my-6">
      <a href={src} aria-label={`Open full-size screenshot: ${alt}`} className={`${focus} block cursor-zoom-in overflow-hidden rounded-lg border border-border`}>
        {/* The WebP is captured and optimized ahead of time. */}
        <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" className="h-auto w-full" />
      </a>
      <figcaption className="mt-2.5 text-sm leading-6 text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}
