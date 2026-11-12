export type DocsSearchEntry = {
  href: string;
  guide: string;
  title: string;
  text: string;
  searchTerms?: string[];
};

const commonWords = new Set(["a", "an", "and", "can", "do", "for", "how", "i", "in", "is", "of", "on", "the", "to", "with"]);

function words(text: string) {
  return text.toLowerCase().replace(/\bset[\s-]+up\b/g, "setup").match(/[a-z0-9]+/g) ?? [];
}

function match(tokens: string[], term: string) {
  if (tokens.includes(term)) return 2;
  if (term.length < 3) return 0;
  return tokens.some((word) => word.startsWith(term) || term === `${word}s` || term === `${word}es`) ? 1 : 0;
}

export function searchDocs(entries: DocsSearchEntry[], query: string) {
  const terms = [...new Set(words(query).filter((word) => !commonWords.has(word)))];
  if (!terms.length) return [];

  return entries.flatMap((entry) => {
    const title = words(entry.title);
    const aliases = words(entry.searchTerms?.join(" ") ?? "");
    const guide = words(entry.guide);
    const text = words(entry.text);
    let score = 0;

    for (const term of terms) {
      const weight = Math.max(6 * match(title, term), 4 * match(aliases, term), 2 * match(guide, term), match(text, term));
      if (!weight) return [];
      score += weight;
    }

    return [{ entry, score }];
  }).sort((a, b) => b.score - a.score).slice(0, 8).map(({ entry }) => entry);
}
