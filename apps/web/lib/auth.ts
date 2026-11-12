import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins";
import { env } from "cloudflare:workers";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { and, eq, lte } from "drizzle-orm";
import { claimInvites, hasEligibleInvite } from "@tasks/core/domain";
import { account, session, user, verification } from "@tasks/core/schema";
import { isEmailAddress, normalizeEmail, signupEmailPolicy } from "./signup-policy";
import { emailEnabled, sendMail, type MailMessage } from "./smtp";

type AuthOptions = {
  database: D1Database;
  secret: string;
  baseURL: string;
  googleClientId: string;
  googleClientSecret: string;
  signupEmailAllowlist?: string;
  sendMail?: (message: MailMessage) => Promise<void>;
};

const maxNameLength = 80;
const issuePath = "/email-otp/send-verification-otp";
const signInPath = "/sign-in/email-otp";

function userDatabase(db: DrizzleD1Database) {
  const baseAdapter = drizzleAdapter(db, {
    provider: "sqlite",
    schema: { user, session, account, verification },
  });

  return (...args: Parameters<typeof baseAdapter>) => {
    const adapter = baseAdapter(...args);
    return {
      ...adapter,
      async findOne<T>(query: Parameters<typeof adapter.findOne>[0]): Promise<T | null> {
        const found = await adapter.findOne<T>(query);
        if (found || query.model !== "user" || !query.where.some((condition) => condition.field === "email")) {
          return found;
        }

        // Better Auth normalizes new emails. Also find existing rows created by
        // older tooling that preserved the case of the user's email address.
        const matches = await adapter.findMany<T>({
          ...query,
          where: query.where.map((condition) => condition.field === "email"
            ? { ...condition, mode: "insensitive" }
            : condition),
          limit: 2,
        });
        if (matches.length > 1) {
          throw new APIError("CONFLICT", { message: "Multiple accounts use this email address." });
        }
        return matches[0] ?? null;
      },
    };
  };
}

async function claimForSignIn(db: DrizzleD1Database, userId: string, email: string) {
  try {
    await claimInvites(db, userId, email);
  } catch (error) {
    // A failed claim must leave the user able to sign in and retry.
    console.error("Invite claiming failed.", error);
  }
}

async function reserveOtpSend(db: DrizzleD1Database, email: string) {
  const now = new Date();
  const id = `tasks:otp-send:${email}`;
  const expiresAt = new Date(now.getTime() + 60_000);
  const [reserved] = await db.insert(verification).values({ id, identifier: id, value: "", expiresAt })
    .onConflictDoUpdate({
      target: verification.id,
      set: { expiresAt },
      setWhere: lte(verification.expiresAt, now),
    })
    .returning({ id: verification.id });
  return reserved ? { id, expiresAt } : null;
}

export function createTasksAuth(options: AuthOptions) {
  const db = drizzle(options.database);
  const allowedBySetting = signupEmailPolicy(options.signupEmailAllowlist);
  const canCreate = (email: string, verified: boolean) =>
    allowedBySetting(email) || (verified && hasEligibleInvite(db, email));
  const deniedSignup = () => new APIError("FORBIDDEN", {
    code: "SIGNUP_RESTRICTED",
    message: "Use an allowed email address or ask for an invitation.",
  });

  const otp = emailOTP({
    expiresIn: 300,
    allowedAttempts: 3,
    storeOTP: "encrypted",
    async sendVerificationOTP({ email, otp }) {
      await options.sendMail?.({
        to: email,
        subject: "Your TasksHQ sign-in code",
        text: `Your TasksHQ sign-in code is ${otp}. It expires in 5 minutes.\n\nYou can ignore this email if you did not request a code.`,
      });
    },
  });

  // Use the plugin to generate and store the code, then submit it synchronously
  // so the request can report an SMTP failure. Its default sender logs failures
  // and returns success. Retain its request schema, CSRF check and rate limits.
  const sendVerificationOTP = createAuthEndpoint(
    issuePath,
    otp.endpoints.sendVerificationOTP.options,
    async (ctx) => {
      const email = normalizeEmail(ctx.body.email);
      if (!options.sendMail || ctx.body.type !== "sign-in" || !isEmailAddress(email)) {
        throw new APIError("BAD_REQUEST", { message: "Enter a valid email address." });
      }
      const reservation = await reserveOtpSend(db, email);
      if (!reservation) {
        throw new APIError("TOO_MANY_REQUESTS", { message: "Wait a minute before requesting another code." });
      }
      let issuedCodeId: string | undefined;
      try {
        const existing = await ctx.context.internalAdapter.findUserByEmail(email);
        // Use the same response and cooldown for ineligible addresses.
        if (!existing && !await canCreate(email, true)) return ctx.json({ success: true });
        const code = await otp.endpoints.createVerificationOTP({
          body: { email, type: "sign-in" },
          context: ctx.context,
        });
        // Better Auth's sign-in OTP identifier. Save the specific row so a
        // failed resend leaves an earlier, still-valid code usable.
        issuedCodeId = (await ctx.context.internalAdapter.findVerificationValue(`sign-in-otp-${email}`))?.id;
        await otp.options.sendVerificationOTP({ email, otp: code, type: "sign-in" });
      } catch {
        const release = db.delete(verification).where(and(
          eq(verification.id, reservation.id),
          eq(verification.expiresAt, reservation.expiresAt),
        ));
        if (issuedCodeId) await db.batch([release, db.delete(verification).where(eq(verification.id, issuedCodeId))]);
        else await release;
        throw new APIError("SERVICE_UNAVAILABLE", { message: "We couldn’t send a code. Try again." });
      }
      return ctx.json({ success: true });
    },
  );

  return betterAuth({
    database: userDatabase(db),
    secret: options.secret,
    baseURL: options.baseURL,
    socialProviders: {
      google: {
        clientId: options.googleClientId,
        clientSecret: options.googleClientSecret,
      },
    },
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    rateLimit: options.sendMail ? {
      enabled: true,
      customRules: { [signInPath]: { window: 60, max: 12 } },
    } : undefined,
    disabledPaths: [
      "/email-otp/check-verification-otp",
      "/email-otp/verify-email",
      "/email-otp/request-password-reset",
      "/email-otp/reset-password",
      "/forget-password/email-otp",
      "/email-otp/request-email-change",
      "/email-otp/change-email",
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/update-user" && ctx.body && Object.hasOwn(ctx.body, "image")) {
          throw new APIError("BAD_REQUEST", { message: "Upload profile photos from account settings." });
        }
        if (ctx.path !== signInPath || !options.sendMail) return;
        if (typeof ctx.body?.email !== "string" || typeof ctx.body.otp !== "string") return;
        const email = normalizeEmail(ctx.body.email);
        if (!isEmailAddress(email) || !/^\d{6}$/.test(ctx.body.otp)) {
          throw new APIError("BAD_REQUEST", { message: "Enter the six-digit code from your email." });
        }
        const name = typeof ctx.body.name === "string" ? ctx.body.name.trim() : "";
        if (!name || name.length > maxNameLength) {
          const existing = await ctx.context.internalAdapter.findUserByEmail(email);
          if (!existing) {
            try {
              // A correct code is restored after this check. Reveal that a
              // name is required only after the requester proves email access.
              await otp.endpoints.checkVerificationOTP({
                context: ctx.context,
                body: { email, otp: ctx.body.otp, type: "sign-in" },
              });
            } catch (error) {
              if (!isAPIError(error) || error.body?.code !== "USER_NOT_FOUND") throw error;
            }
            if (!await canCreate(email, true)) throw deniedSignup();
            throw new APIError("BAD_REQUEST", {
              code: "NAME_REQUIRED",
              message: `Enter your name (up to ${maxNameLength} characters).`,
            });
          }
        }
        return { context: { body: { ...ctx.body, email, name } } };
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (createdUser, context) => {
            const email = normalizeEmail(createdUser.email);
            if (!await canCreate(email, createdUser.emailVerified === true)) throw deniedSignup();
            if (context?.path !== signInPath) return { data: { email } };
            const name = createdUser.name.trim();
            if (!name || name.length > maxNameLength) {
              throw new APIError("BAD_REQUEST", { code: "NAME_REQUIRED", message: "Enter your name." });
            }
            return { data: { email, name, image: null } };
          },
          after: async (createdUser) => {
            if (createdUser.emailVerified) await claimForSignIn(db, createdUser.id, createdUser.email);
          },
        },
      },
      session: {
        create: {
          after: async (createdSession) => {
            const [row] = await db.select({ email: user.email, verified: user.emailVerified })
              .from(user).where(eq(user.id, createdSession.userId));
            if (row?.verified) await claimForSignIn(db, createdSession.userId, row.email);
          },
        },
      },
    },
    // nextCookies() must be last in the array.
    plugins: [
      ...(options.sendMail ? [{
        ...otp,
        endpoints: { ...otp.endpoints, sendVerificationOTP },
      }] : []),
      nextCookies(),
    ],
  });
}

export const auth = createTasksAuth({
  database: env.DB,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  googleClientId: env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  signupEmailAllowlist: (env as Env & { SIGNUP_EMAIL_ALLOWLIST?: string }).SIGNUP_EMAIL_ALLOWLIST,
  sendMail: emailEnabled ? sendMail : undefined,
});

export function claimInvitesForSignIn(userId: string, email: string) {
  return claimForSignIn(drizzle(env.DB), userId, email);
}
