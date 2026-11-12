import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

type Positioned = { id: string; position: string };

/**
 * The fractional key (§3) for a row placed directly after
 * `siblings[afterIndex]`, or first when `afterIndex` is -1. `siblings` is the
 * row's scope in `position, id` order, without the row itself.
 *
 * Equal positions are reachable: concurrent creates each read the same last
 * key before any of them inserts, and `deleteStatus` moves tasks into a
 * column without repositioning them. No key exists between two equal ones,
 * so the run of duplicates around the target is re-keyed — in its current
 * `position, id` order, so nothing visibly reorders — and the new key is
 * taken from the fresh gap. A few rows, and only when a placement lands
 * inside a run.
 *
 * Pure, so tasks and statuses share it: each caller turns `rekeys` into
 * updates on its own table, in the same batch as its own write.
 */
export function placeAfter(
  siblings: Positioned[],
  afterIndex: number,
): { position: string; rekeys: Positioned[] } {
  const before = afterIndex === -1 ? null : siblings[afterIndex].position;
  const next = siblings[afterIndex + 1]?.position ?? null;
  if (before === null || before !== next) {
    return { position: generateKeyBetween(before, next), rekeys: [] };
  }

  let start = afterIndex;
  while (start > 0 && siblings[start - 1].position === before) start--;
  let end = afterIndex + 1;
  while (end + 1 < siblings.length && siblings[end + 1].position === before) {
    end++;
  }
  const keys = generateNKeysBetween(
    siblings[start - 1]?.position ?? null,
    siblings[end + 1]?.position ?? null,
    end - start + 1,
  );
  return {
    position: generateKeyBetween(
      keys[afterIndex - start],
      keys[afterIndex - start + 1],
    ),
    rekeys: siblings
      .slice(start, end + 1)
      .map((s, i) => ({ id: s.id, position: keys[i] })),
  };
}
