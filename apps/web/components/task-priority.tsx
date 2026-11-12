import { ChevronsDown, ChevronsUp, Equal } from "lucide-react";
import type { TaskPriority } from "@tasks/core/schema";
import { cn } from "@/lib/utils";

const priorities = {
  low: { label: "Low", Icon: ChevronsDown, color: "text-muted-foreground" },
  medium: { label: "Medium", Icon: Equal, color: "text-amber-700 dark:text-amber-400" },
  high: { label: "High", Icon: ChevronsUp, color: "text-destructive" },
};

export function taskPriorityLabel(priority: TaskPriority) {
  return priorities[priority].label;
}

export function TaskPriorityIcon({ priority, className }: { priority: TaskPriority; className?: string }) {
  const { label, Icon, color } = priorities[priority];
  const description = `${label} priority`;
  return (
    <span role="img" aria-label={description} title={description} className={cn("inline-flex shrink-0", color, className)}>
      <Icon aria-hidden className="size-4" />
    </span>
  );
}
