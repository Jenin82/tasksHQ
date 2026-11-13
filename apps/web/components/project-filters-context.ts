import { createContext, type Dispatch, type SetStateAction } from "react";

export type PeopleSelection = ReadonlySet<string | null>;
export type FilterView = "board" | "table";
export type ProjectFilters = {
  query: string;
  status: string;
  type: string;
  organization: string;
  projectId: string;
  assignees: PeopleSelection;
  creators: PeopleSelection;
  reporters: PeopleSelection;
  hideSubtasks: boolean;
};

export function emptyProjectFilters(): ProjectFilters {
  return { query: "", status: "", type: "", organization: "", projectId: "", assignees: new Set(), creators: new Set(), reporters: new Set(), hideSubtasks: false };
}

export const ProjectFiltersContext = createContext<{
  filters: ProjectFilters;
  setFilters: Dispatch<SetStateAction<ProjectFilters>>;
  currentUser?: { id: string; displayName: string };
} | null>(null);

// Keep the slot stable when the toolbar or a consuming page hot reloads.
export const ProjectFilterSlot = createContext<{
  host: HTMLDivElement | null;
  view: FilterView | null;
} | null>(null);
