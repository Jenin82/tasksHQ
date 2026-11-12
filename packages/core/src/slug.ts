import { DomainError } from "./errors";

/**
 * Paths the app owns. An org slugged `api` would shadow `/api/auth/...`, and
 * `settings`/`consent`/`authorize` collide with routes §4.6 and §5 define.
 * M2's top-level segments are reserved before they exist: `/oauth/token`,
 * `/internal/introspect` (§1, §5.6), and `token`/`register`/`mcp` because the
 * OAuth library's endpoint defaults and the MCP path use those names — an org
 * claiming one now would block or shadow the route when it ships.
 * `projects` is reserved because `/[org]/projects` is a static route that
 * would shadow a project with that slug; the list is shared with org slugs,
 * where it is harmless.
 *
 * Imported by both the domain layer (on create) and the routing layer, so the
 * two cannot drift.
 */
export const RESERVED_SLUGS = [
  "api",
  "login",
  "new",
  "settings",
  "consent",
  "authorize",
  "_next",
  ".well-known",
  "oauth",
  "internal",
  "token",
  "register",
  "mcp",
  "projects",
  "docs",
] as const;

const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9]*$/;
const MAX_SLUG_LENGTH = 48;
const MAX_PROJECT_KEY_LENGTH = 6;

function isReservedSlug(slug: string) {
  return (RESERVED_SLUGS as readonly string[]).includes(slug);
}

function nameToSlug(name: string) {
  return name.normalize("NFKD").replace(/\p{Mark}/gu, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function suggestSlug(name: string, kind: "org" | "project") {
  const slug = nameToSlug(name).slice(0, MAX_SLUG_LENGTH).replace(/-$/, "");
  if (!slug) return "";
  return slug.length === 1 || isReservedSlug(slug) ? `${slug}-${kind}` : slug;
}

export function suggestProjectKey(name: string) {
  const words = nameToSlug(name).replace(/^[0-9-]+/, "").toUpperCase().split("-");
  const [first] = words;
  if (!first) return "";
  const key = words.length > 1
    ? words.map((word) => word[0]).join("").slice(0, MAX_PROJECT_KEY_LENGTH)
    : first.slice(0, 3);
  return key.length === 1 ? `${key}1` : key;
}

export function assertValidSlug(label: string, slug: string) {
  if (slug.length < 2 || slug.length > MAX_SLUG_LENGTH) {
    throw new DomainError(`${label} must be between 2 and 48 characters.`);
  }
  if (!SLUG.test(slug)) {
    throw new DomainError(
      `${label} may contain only lowercase letters, numbers and hyphens, and must start and end with a letter or number.`,
    );
  }
  if (isReservedSlug(slug)) {
    throw new DomainError(`"${slug}" is reserved.`);
  }
}

export function assertValidProjectKey(key: string) {
  if (key.length < 2 || key.length > MAX_PROJECT_KEY_LENGTH) {
    throw new DomainError("Project key must be between 2 and 6 characters.");
  }
  if (!PROJECT_KEY.test(key)) {
    throw new DomainError(
      "Project key must be uppercase letters and numbers, starting with a letter.",
    );
  }
}
