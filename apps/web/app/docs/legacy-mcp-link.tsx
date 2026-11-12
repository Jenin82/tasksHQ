"use client";

import { useEffect } from "react";
import { guideHref, legacyMcpSections } from "./topics";

export function LegacyMcpLink() {
  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    if (legacyMcpSections.includes(fragment)) window.location.replace(guideHref("mcp", fragment));
  }, []);
  return null;
}
