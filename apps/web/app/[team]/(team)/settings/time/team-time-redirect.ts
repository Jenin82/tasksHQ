import { getTeamContext } from "@/lib/team-context";

/**
 * Team Time moved to the organization. The old team URL, for one release,
 * becomes the Time page filtered to that team, keeping only the known params.
 */
export async function teamTimeRedirect(slug: string, input: URLSearchParams | Record<string, string | string[] | undefined>, path: string) {
  const { team } = await getTeamContext(slug);
  const get = (name: string) => {
    const value = input instanceof URLSearchParams ? input.get(name) : input[name];
    return typeof value === "string" ? value : undefined;
  };
  const query = new URLSearchParams({ team: team.slug });
  for (const name of ["week", "month"]) {
    const value = get(name);
    if (value) query.set(name, value);
  }
  // The old page showed the whole team; its single-person view stays strict
  // as a legacy `person`, which 404s when out of scope.
  const person = get("person");
  if (person) query.set("person", person);
  else query.set("people", "all");
  return `${path}?${query}`;
}
