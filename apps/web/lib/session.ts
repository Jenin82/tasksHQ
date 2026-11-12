import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export type SessionUser = { id: string; name: string; email: string; image?: string | null };

/** The signed-in user, or null. PLAN §4.3: the session is read server-side. */
export async function getUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/**
 * The signed-in user, or a redirect to the sign-in screen, which is `/`.
 * Every authenticated route goes through this, directly or via getOrgContext.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/");
  return user;
}
