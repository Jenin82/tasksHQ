import { expect, it } from "vitest";
import {
  assertValidProjectKey,
  assertValidSlug,
  suggestProjectKey,
  suggestSlug,
} from "@tasks/core/slug";

it("normalizes accents and punctuation in slug suggestions", () => {
  const name = "  Déjà Vu / Ångström  ";
  expect(suggestSlug(name, "org")).toBe("deja-vu-angstrom");
  expect(suggestSlug(name, "project")).toBe("deja-vu-angstrom");
});

it("gives reserved and one-character slugs a valid suffix", () => {
  expect(suggestSlug("OAuth", "org")).toBe("oauth-org");
  expect(suggestSlug("Docs", "org")).toBe("docs-org");
  expect(() => assertValidSlug("Organization slug", "docs")).toThrow(/reserved/);
  expect(suggestSlug("Prójects", "project")).toBe("projects-project");
  expect(suggestSlug("É", "org")).toBe("e-org");
  expect(suggestSlug("7", "project")).toBe("7-project");
});

it("fits slug suggestions within 48 characters and removes a trailing separator", () => {
  expect(suggestSlug("A".repeat(60), "project")).toBe("a".repeat(48));
  const slug = suggestSlug(`${"A".repeat(47)} / longer`, "org");
  expect(slug).toBe("a".repeat(47));
  expect(() => assertValidSlug("Organization slug", slug)).not.toThrow();
});

it("uses uppercase initials or a single-word prefix for project keys", () => {
  expect(suggestProjectKey("Déjà Vu / Ångström")).toBe("DVA");
  expect(suggestProjectKey("123 Élan Team")).toBe("ET");
  expect(suggestProjectKey("123Élan")).toBe("ELA");
  expect(suggestProjectKey("É")).toBe("E1");
  const key = suggestProjectKey("Alpha Beta Charlie Delta Echo Foxtrot Golf");
  expect(key).toBe("ABCDEF");
  expect(() => assertValidProjectKey(key)).not.toThrow();
});

it("leaves the suggestion blank when the name has no usable characters", () => {
  const name = "世界 — 💡";
  expect(suggestSlug(name, "org")).toBe("");
  expect(suggestSlug(name, "project")).toBe("");
  expect(suggestProjectKey(name)).toBe("");
  expect(suggestProjectKey("123-456")).toBe("");
});
