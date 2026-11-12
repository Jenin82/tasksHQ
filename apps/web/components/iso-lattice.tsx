// The footer's cube grid as faint lines: one rhombus per cube top, at the same
// 2:1 isometric angle. Masked so it is strongest at the top edge and gone by
// the time the headline starts — background, never competing with the text.
// Behind `/` (signed in and out) and the `/[org]` project page; the parent
// must be `relative`.
export function IsoLattice() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[70%] w-full text-foreground/[0.07] dark:text-foreground/[0.14] [mask-image:linear-gradient(to_bottom,black_20%,transparent)]"
    >
      <defs>
        <pattern id="iso-lattice" width="56" height="28" patternUnits="userSpaceOnUse">
          <path d="M0 14 28 0 56 14 28 28Z" fill="none" stroke="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#iso-lattice)" />
    </svg>
  );
}
