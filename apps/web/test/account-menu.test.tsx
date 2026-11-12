import { renderToStaticMarkup } from "react-dom/server.browser";
import { expect, it, vi } from "vitest";

// Radix renders a closed menu to nothing, so the menu parts are swapped for
// plain wrappers to see what the open menu would hold.
vi.mock("@/components/ui/dropdown-menu", () => {
  const Plain = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    DropdownMenu: Plain,
    DropdownMenuContent: Plain,
    DropdownMenuItem: Plain,
    DropdownMenuLabel: Plain,
    DropdownMenuSeparator: Plain,
    DropdownMenuTrigger: Plain,
  };
});
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));

const { AccountMenu } = await import("@/components/account-menu");

it("holds the name, the email and sign out, and no theme item", () => {
  const html = renderToStaticMarkup(
    <AccountMenu user={{ name: "Ada Lovelace", email: "ada@example.test" }} />,
  );

  expect(html).toContain("Ada Lovelace");
  expect(html).toContain("ada@example.test");
  expect(html).toContain("Sign out");
  expect(html.toLowerCase()).not.toContain("theme");
});
