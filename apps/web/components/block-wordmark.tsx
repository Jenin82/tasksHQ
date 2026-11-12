import { IsoCubes, isoBounds, type Cube } from "@/components/iso";

// The footer's isometric block wordmark: each "#" below is extruded into
// DEPTH unit cubes, drawn by IsoCubes.
const LETTERS: string[][] = [
  ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."], // T
  [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"], // A
  [".####", "#....", "#....", ".###.", "....#", "....#", "####."], // S
  ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"], // K
  [".####", "#....", "#....", ".###.", "....#", "....#", "####."], // S
  ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"], // H
  [".###.", "#...#", "#...#", "#.#.#", "#..#.", ".##.#", "....#"], // Q: the tail starts inside the bowl so it shows in the cropped footer
];

export const DEPTH = 2;
// Each letter steps right along x and back along z, so the word runs level
// across the page while every letter sits on its own isometric plane.
const STEP = 4;

const cubes: Cube[] = LETTERS.flatMap((rows, i) =>
  rows.flatMap((row, r) =>
    [...row].flatMap((px, c) =>
      px === "#"
        ? Array.from({ length: DEPTH }, (_, d) => ({
            x: i * STEP + c,
            y: rows.length - 1 - r,
            z: -i * STEP + d,
          }))
        : [],
    ),
  ),
);

// Share of the wordmark left visible: the bottom is cut off by the page edge,
// like the reference, so the letters read as running past the screen.
const VISIBLE = 0.65;
const { width, height } = isoBounds(cubes);

export function BlockWordmark() {
  return (
    <div className="overflow-hidden" style={{ aspectRatio: `${width} / ${height * VISIBLE}` }}>
      <IsoCubes cubes={cubes} />
    </div>
  );
}
