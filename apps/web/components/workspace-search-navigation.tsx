"use client";

import { createContext, useContext, useLayoutEffect, useRef } from "react";
import Link, { useLinkStatus } from "next/link";

export type SearchDestination = { href: string; view: "board" | "table" | "task" };

export const WorkspaceSearchPending = createContext<(destination: SearchDestination | null) => void>(() => {});

// Keep the Link mounted when cmdk closes so the router can report when its
// navigation settles or is superseded, including by browser Back.
export function WorkspaceSearchNavigation({ destination }: { destination: SearchDestination }) {
  const link = useRef<HTMLAnchorElement>(null);
  const clicked = useRef(false);

  useLayoutEffect(() => {
    if (clicked.current) return;
    clicked.current = true;
    link.current?.click();
  }, []);

  return (
    <Link ref={link} href={destination.href} hidden prefetch={false}>
      <Pending destination={destination} />
    </Link>
  );
}

function Pending({ destination }: { destination: SearchDestination }) {
  const { pending } = useLinkStatus();
  const setPending = useContext(WorkspaceSearchPending);

  useLayoutEffect(() => {
    if (!pending) return;
    setPending(destination);
    return () => setPending(null);
  }, [destination, pending, setPending]);

  return null;
}
