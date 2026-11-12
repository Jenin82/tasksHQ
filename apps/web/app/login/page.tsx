import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Mark } from "@/components/mark";
import { AUTH_ISSUER } from "@/lib/mcp-oauth";
import { getUser } from "@/lib/session";
import { emailEnabled } from "@/lib/smtp";
import { taskSignInDestination, taskSignInUrl } from "@/lib/task-sign-in";
import { findSignIn } from "../authorize/flow";
import { EmailSignIn } from "./email-sign-in";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ nonce?: string | string[]; next?: string | string[] }>;
}) {
  const { nonce, next } = await searchParams;
  const homeUrl = taskSignInUrl(nonce === undefined ? taskSignInDestination(next) : null);
  if (!emailEnabled) redirect(homeUrl);
  const transaction = typeof nonce === "string" && await findSignIn(
    new Request(AUTH_ISSUER, { headers: await headers() }), nonce,
  );
  const destination = transaction ? `/authorize/resume?nonce=${transaction.nonce}` : homeUrl;
  if ((nonce === undefined || transaction) && await getUser()) redirect(destination);

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm space-y-5 rounded-2xl bg-card p-6 shadow-subtle sm:p-8">
        <Mark className="size-4" />
        <h1 className="text-2xl">Sign in with email</h1>
        {nonce !== undefined && !transaction ? (
          <p role="alert" className="text-sm text-muted-foreground">
            This connection has expired. Start it again from your MCP client.
          </p>
        ) : <EmailSignIn destination={destination} />}
        {!transaction && <Link href={homeUrl} className="text-sm underline underline-offset-4">Back to TasksHQ</Link>}
      </div>
    </main>
  );
}
