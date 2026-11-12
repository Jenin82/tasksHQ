"use client";

import { createContext, useContext, type ComponentProps } from "react";
import Link from "next/link";

export const ProjectViewHref = createContext((base: string) => base);

export function ProjectViewLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const projectHref = useContext(ProjectViewHref);
  return <Link href={projectHref(href)} {...props} />;
}
