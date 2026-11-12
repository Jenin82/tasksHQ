import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, count, eq } from "drizzle-orm";
import { org, orgMember, project } from "@tasks/core/schema";
import { AccountMenu } from "@/components/account-menu";
import { DocsLink } from "@/components/docs-link";
import { GoogleSignIn } from "@/components/google-sign-in";
import { IsoLattice } from "@/components/iso-lattice";
import { Mark } from "@/components/mark";
import { SiteFooter } from "@/components/site-footer";
import { ThemeButton } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { claimInvitesForSignIn } from "@/lib/auth";
import { db } from "@/lib/db";
import { getUser } from "@/lib/session";
import { emailEnabled } from "@/lib/smtp";
import { taskSignInDestination, taskSignInUrl } from "@/lib/task-sign-in";
import { NewOrgDialog } from "./new-org-dialog";

// Reads the session, so it is per-user by definition. Stated explicitly so
// that a prerender pass (e.g. `deploy --prerender-all`) can never bake it.
export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: {
  searchParams?: Promise<{ next?: string | string[] }>;
} = {}) {
  const taskPath = taskSignInDestination((await searchParams)?.next);
  const user = await getUser();
  if (!user)
    return (
      <WithFooter backdrop={<IsoLattice />}>
        <SignIn taskPath={taskPath} />
      </WithFooter>
    );

  // The invitation link is the app homepage. A user with a current session
  // can follow it without reauthenticating to pick up a new invite.
  await claimInvitesForSignIn(user.id, user.email);
  if (taskPath) redirect(taskPath);
  const memberships = await db
    .select({ id: org.id, slug: org.slug, name: org.name, role: orgMember.role })
    .from(orgMember)
    .innerJoin(org, eq(org.id, orgMember.orgId))
    .where(eq(orgMember.userId, user.id))
    .orderBy(asc(org.name));
  const orgs = await Promise.all(
    memberships.map(async (o) => {
      const [row] = await db
        .select({ projects: count() })
        .from(project)
        .where(eq(project.orgId, o.id));
      return { ...o, projects: row.projects };
    }),
  );

  // `/` is where orgs are listed and made, whatever the count,
  // and `/[org]` lists its projects. Creating one is the dialog beside
  // the heading — the page's single primary button — so the empty state has none.
  return (
    <WithFooter
      backdrop={<IsoLattice />}
      actions={
        <>
          <ThemeButton size="icon" />
          <AccountMenu user={{ name: user.name, email: user.email, image: user.image }} />
        </>
      }
    >
      <main className="relative flex-1 px-4 py-12 sm:px-6">
        <div className="mx-auto max-w-[1200px] px-6 sm:px-10">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div>
              <p className="stutter">Organizations</p>
              <h1 className="mt-3 text-2xl">Where would you like to work?</h1>
            </div>
            <NewOrgDialog />
          </div>

          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {orgs.length === 0 ? (
              <li className="rounded-2xl bg-card p-5 shadow-subtle">
                <p>No organizations yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  No invite is waiting for your address. Make one with New
                  organization, then invite the rest of the team.
                </p>
              </li>
            ) : (
              orgs.map((o) => (
                <li key={o.slug}>
                  {/* Hover is a foreground wash over the card, not `--accent`
                      or the blue (§7.4, §7.5): the stutter lines are muted. */}
                  <Link
                    href={`/${o.slug}`}
                    className="flex h-full flex-col gap-3 rounded-2xl bg-card p-5 shadow-subtle outline-none transition-colors hover:bg-[color-mix(in_oklab,var(--card),var(--foreground)_5%)] focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="truncate text-base">{o.name}</span>
                    {/* §7.1: words beside the numeral, spaced, no divider. */}
                    <span className="flex items-baseline justify-between gap-4">
                      <span className="stutter">{o.role}</span>
                      <span className="stutter">
                        <span className="numeral">{o.projects}</span>{" "}
                        {o.projects === 1 ? "project" : "projects"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </div>
      </main>
    </WithFooter>
  );
}

// `/`'s shell, signed in or out: the mark, then the theme button signed out
// or `actions` at the right edge signed in (the theme button and the account
// menu, as in the top bar), the page, then the footer, its block wordmark
// cut off by the page bottom. The page fills the viewport; on a laptop-height screen the whole of it, footer included, fits
// without scrolling. `backdrop` sits behind the header and the page.
function WithFooter({
  children,
  backdrop,
  actions,
}: {
  children: React.ReactNode;
  backdrop?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="relative flex flex-1 flex-col">
        {backdrop}
        <header className="relative px-4 sm:px-6">
          <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-2 px-6 sm:px-10">
            <Mark className="size-4" />
            {actions ? (
              <div className="ml-auto flex items-center gap-2"><DocsLink />{actions}</div>
            ) : (
              <>
                <ThemeButton />
                <nav aria-label="Main" className="ml-auto"><DocsLink /></nav>
              </>
            )}
          </div>
        </header>
        {children}
      </div>
      <SiteFooter />
    </div>
  );
}

// The signed-out `/` is the product's one marketing surface (§7.3), over a
// faint isometric lattice. The product's claim, then its proof: a statement in two tones on the left,
// on the same column as the mark and the footer; on the right, three rows of
// the activity history it promises — who did what, from the web or an agent.
function SignIn({ taskPath }: { taskPath: string | null }) {
  return (
    <main className="relative flex flex-1 items-center px-4 py-8 sm:px-6">
      <div className="mx-auto grid w-full max-w-[1200px] items-end gap-12 px-6 motion-safe:animate-rise sm:px-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-20">
        <div>
          <h1 className="text-[36px] leading-[1.05] font-normal tracking-[-0.04em] sm:text-[52px]">
            Work, tracked
            <br />
            <span className="text-muted-foreground">by people and agents.</span>
          </h1>
          <p className="mt-5 max-w-md text-base text-muted-foreground">
            Boards for your team. An MCP server for your agents. One history of who
            did what.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="w-64 space-y-3">
              <GoogleSignIn callbackURL={taskSignInUrl(taskPath)} />
              {emailEnabled && (
                <Button asChild variant="outline" size="lg" className="w-full">
                  <Link href={taskPath ? `/login?next=${encodeURIComponent(taskPath)}` : "/login"}>Continue with email</Link>
                </Button>
              )}
            </div>
          </div>
        </div>
        <Ledger />
      </div>
    </main>
  );
}

const LEDGER = [
  { key: "ENG-42", what: "Moved to Done", who: "Ana", via: "web" },
  { key: "ENG-57", what: "Created", who: "Claude", via: "mcp" },
  { key: "ENG-61", what: "Assigned to Ben", who: "Cursor", via: "mcp" },
] as const;

// Decorative, so hidden from assistive tech; the paragraph beside it already
// says what it shows. Columns, not separators: numerals are never crowded.
function Ledger() {
  return (
    <div aria-hidden className="hidden lg:block">
      <div className="flex justify-between border-b border-border pb-3">
        <span className="stutter">History</span>
        <span className="stutter">Via</span>
      </div>
      <ul>
        {LEDGER.map((row) => (
          <li
            key={row.key}
            className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-4 border-b border-border py-3"
          >
            <span className="stutter numeral">{row.key}</span>
            <span className="truncate text-sm">
              {row.what}
              <span className="text-muted-foreground"> by {row.who}</span>
            </span>
            <span className="stutter">{row.via}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
