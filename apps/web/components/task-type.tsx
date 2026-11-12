import { BookOpen, Bug, ClipboardList, Flag, Sparkles, Star, Wrench, Zap } from "lucide-react";
import type { TaskTypeRef } from "@tasks/core/domain";
import type { TaskTypeIconName } from "@tasks/core/schema";
import { statusColorClass } from "@/lib/status-style";
import { cn } from "@/lib/utils";

export const taskTypeIcons = {
  task: { label: "Clipboard", Icon: ClipboardList },
  bug: { label: "Bug", Icon: Bug },
  feature: { label: "Sparkles", Icon: Sparkles },
  book: { label: "Book", Icon: BookOpen },
  wrench: { label: "Wrench", Icon: Wrench },
  flag: { label: "Flag", Icon: Flag },
  star: { label: "Star", Icon: Star },
  lightning: { label: "Lightning", Icon: Zap },
} satisfies Record<TaskTypeIconName, { label: string; Icon: typeof Bug }>;

export function TaskTypeIcon({ icon, color }: Pick<TaskTypeRef, "icon" | "color">) {
  const { Icon } = taskTypeIcons[icon];
  return <Icon aria-hidden className={cn("size-4 shrink-0 text-(--status-color)", statusColorClass(color))} />;
}

export function TaskTypeBadge({ type }: { type: TaskTypeRef }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground" title={type.name}>
      <TaskTypeIcon icon={type.icon} color={type.color} />
      <span className="truncate">{type.name}</span>
    </span>
  );
}
