import { createContext, useContext } from "react";
import type { TaskPreview } from "./task-dialog";

export type OpenTask = (task: TaskPreview, trigger: HTMLElement) => void;

// Keep the context in a shared dependency of the client entry points. Vite
// can reload the dialog component separately from the board and table.
export const OpenTaskContext = createContext<OpenTask | null>(null);

export function useOpenTaskDialog() {
  return useContext(OpenTaskContext);
}
