import { useId } from "react";

// Unit cubes projected 2:1 isometric, drawn for the footer's block wordmark.
// One cube is defined once; every cube is a translated <use> of it, drawn in
// painter's order (back to front).
export type Cube = { x: number; y: number; z: number };

// Vertical edge length: ≈ √5, the length of a 2:1 horizontal edge.
const H = 2.25;
const project = (x: number, y: number, z: number) => [2 * x - 2 * z, x + z - H * y];

const pts = (...corners: [number, number, number][]) =>
  corners.map((c) => project(...c).join(",")).join(" ");
const TOP = pts([0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]);
const LEFT = pts([0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]);
const RIGHT = pts([1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]);

// The viewBox that holds every cube; the SVG sizes itself from its ratio.
export function isoBounds(cubes: Cube[]) {
  const xs = cubes.flatMap((c) => [2 * (c.x - c.z) - 2, 2 * (c.x - c.z) + 2]);
  const ys = cubes.flatMap((c) => [c.x + c.z - H * (c.y + 1), c.x + c.z + 2 - H * c.y]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

// Face colours are custom properties set on the <svg>: elements cloned into a
// <use> tree inherit from the <use>, but `.dark` selectors never match them.
const THEME =
  "[--block-top:#d4d4d8] [--block-left:#a1a1aa] [--block-right:#bcbcc2] [--seam-top:#c4c4ca] [--seam-left:#95959e] [--seam-right:#b0b0b7] " +
  "dark:[--block-top:#7a7a7a] dark:[--block-left:#232323] dark:[--block-right:#353535] dark:[--seam-top:#6c6c6c] dark:[--seam-left:#1a1a1a] dark:[--seam-right:#2a2a2a]";

// Seams stay 1px at any size, so the cubes read as separate blocks.
const face = (fill: string, seam: string) => ({
  fill: `var(${fill})`,
  stroke: `var(${seam})`,
  strokeWidth: 1,
  strokeLinejoin: "round" as const,
  vectorEffect: "non-scaling-stroke" as const,
});

export function IsoCubes({ cubes }: { cubes: Cube[] }) {
  // Unique per SVG, in case two ever share a page. useId's `«»`/`:` are not
  // valid in a `#fragment` href, so keep only safe characters.
  const id = `iso-cube-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const { minX, minY, width, height } = isoBounds(cubes);
  // A cube can only hide cubes that are no greater on every axis, so sorting
  // by the coordinate sum is a valid back-to-front order.
  const sorted = [...cubes].sort((a, b) => a.x + a.y + a.z - (b.x + b.y + b.z));

  return (
    <svg
      viewBox={`${minX} ${minY} ${width} ${height}`}
      width="100%"
      aria-hidden
      className={`block ${THEME}`}
    >
      <defs>
        <g id={id}>
          <polygon points={TOP} style={face("--block-top", "--seam-top")} />
          <polygon points={LEFT} style={face("--block-left", "--seam-left")} />
          <polygon points={RIGHT} style={face("--block-right", "--seam-right")} />
        </g>
      </defs>
      {sorted.map(({ x, y, z }) => {
        const [px, py] = project(x, y, z);
        return <use key={`${x},${y},${z}`} href={`#${id}`} x={px} y={py} />;
      })}
    </svg>
  );
}
