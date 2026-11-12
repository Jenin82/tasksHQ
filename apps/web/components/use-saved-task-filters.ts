"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import { emptyProjectFilters, type ProjectFilters } from "./project-filters-context";

function readFilters(key: string, previousDefaultAssignee?: string): ProjectFilters | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved.query !== "string" || typeof saved.status !== "string" ||
        typeof saved.type !== "string" || !Array.isArray(saved.assignees) || !Array.isArray(saved.creators)) {
      return null;
    }
    const people = (values: unknown[]) =>
      new Set(values.filter((value): value is string | null => value === null || typeof value === "string"));
    const assignees = people(saved.assignees);
    // The old project views saved their implicit self-filter alongside any
    // other filter the user changed. Old snapshots cannot distinguish it
    // from a manually selected self-filter.
    if (previousDefaultAssignee && saved.assigneeDefaultsRemoved !== true &&
        assignees.size === 1 && assignees.has(previousDefaultAssignee)) {
      assignees.clear();
    }
    return {
      query: saved.query,
      status: saved.status,
      type: saved.type,
      organization: typeof saved.organization === "string" ? saved.organization : "",
      projectId: typeof saved.projectId === "string" ? saved.projectId : "",
      assignees,
      creators: people(saved.creators),
    };
  } catch {
    return null;
  }
}

export function useSavedTaskFilters(scope?: string, previousDefaultAssignee?: string) {
  const key = scope ? `tasks:filters:v1:${scope}` : undefined;
  const initial = useMemo(emptyProjectFilters, []);
  const [snapshot, setSnapshot] = useState(() => ({ key, filters: initial, dirty: false }));

  useLayoutEffect(() => {
    setSnapshot({ key, filters: (key && readFilters(key, previousDefaultAssignee)) || initial, dirty: false });
  }, [key, initial, previousDefaultAssignee]);

  useLayoutEffect(() => {
    if (!key || snapshot.key !== key || !snapshot.dirty) return;
    const { filters } = snapshot;
    try {
      localStorage.setItem(key, JSON.stringify({
        ...filters,
        assigneeDefaultsRemoved: true,
        assignees: [...filters.assignees],
        creators: [...filters.creators],
      }));
    } catch {
      // Filters still work for this visit when browser storage is unavailable.
    }
  }, [key, snapshot]);

  const setFilters: React.Dispatch<React.SetStateAction<ProjectFilters>> = (next) => {
    setSnapshot((current) => ({
      key,
      filters: typeof next === "function" ? next(current.key === key ? current.filters : initial) : next,
      dirty: true,
    }));
  };

  return [snapshot.key === key ? snapshot.filters : initial, setFilters] as const;
}
