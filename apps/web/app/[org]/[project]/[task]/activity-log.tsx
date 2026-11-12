import type {
  TaskActivityEntry,
  UpdatedFields,
} from "@tasks/core/domain";
import { shortDateTime } from "@/lib/format";
import { formatTaskDueDate } from "@/lib/task-due-date";
import { taskPriorityLabel } from "@/components/task-priority";

/**
 * §7.2's lightest surface: the activity log sits at the bottom of the page and
 * is almost entirely metadata, so it is the stutter register throughout except
 * for names and the one comment excerpt it quotes.
 */

/**
 * §2's whole point, rendered. `source` says web or MCP; `clientName` says
 * *which* agent, recorded at consent time by §5.7 precisely so this question
 * is answerable later.
 *
 * Both registers stay muted per §7.3 — an MCP row is told apart by what it
 * says, not by a second colour or a box. Comments carry a `source` and no
 * client (§3 duplicates the column so the badge needs no join), so the client
 * name is optional here.
 */
export function SourceBadge({
  source,
  clientName,
}: {
  source: "web" | "mcp";
  clientName?: string | null;
}) {
  return (
    <span className="stutter shrink-0" data-source={source}>
      {source === "mcp" && clientName ? `mcp ${clientName}` : source}
    </span>
  );
}

function Status({ name }: { name: string }) {
  return <span className="stutter">{name}</span>;
}

/** §3: `task.updated` carries scalars, plus the one assignee exception. */
function updatedLines(fields: UpdatedFields): React.ReactNode[] {
  const lines: React.ReactNode[] = [];

  if (fields.title) {
    lines.push(
      <>
        renamed this task to <span className="text-foreground">{fields.title.to}</span>
      </>,
    );
  }

  if (fields.description) {
    lines.push(
      fields.description.to === null
        ? "removed the description"
        : fields.description.from === null
          ? "added a description"
          : "edited the description",
    );
  }

  if (fields.assignee) {
    const { from, to } = fields.assignee;
    lines.push(
      to === null ? (
        <>
          unassigned{" "}
          <span className="text-foreground">{from?.displayName}</span>
        </>
      ) : (
        <>
          assigned <span className="text-foreground">{to.displayName}</span>
        </>
      ),
    );
  }

  if (fields.dueDate) {
    const date = fields.dueDate.to;
    lines.push(date ? (
      <>set the due date to <time dateTime={date} className="text-foreground">{formatTaskDueDate(date)}</time></>
    ) : "cleared the due date");
  }

  if (fields.type) {
    lines.push(<>changed the type to <span className="text-foreground">{fields.type.to}</span></>);
  }

  if (fields.priority) {
    lines.push(<>changed priority to <span className="text-foreground">{taskPriorityLabel(fields.priority.to)}</span></>);
  }

  // §3 lets a payload carry several fields from one call, and `updateTask`
  // writes no row at all when nothing changed — so an empty list is not
  // reachable, but saying so beats rendering a blank line if it ever is.
  return lines.length > 0 ? lines : ["edited this task"];
}

/**
 * The exhaustive switch §18 exported `TaskActivityType` for: `TaskActivityEntry`
 * is keyed off that union, so omitting a case leaves `entry` typed and the
 * `never` assignment below fails to compile, so an unknown type is a build
 * error, not a silently skipped row. At runtime a row can still outrun the
 * build — written by a newer MCP deploy, read by an older web one — and one
 * unreadable row must not take the whole task page down, so it renders a
 * neutral line instead of throwing.
 */
function describe(entry: TaskActivityEntry): React.ReactNode[] {
  switch (entry.type) {
    case "task.created":
      return [
        <>
          created this task in <Status name={entry.data.status.name} />
        </>,
      ];
    case "task.updated":
      return updatedLines(entry.data.fields);
    case "task.moved":
      return [
        <>
          moved this task <Status name={entry.data.from.name} /> →{" "}
          <Status name={entry.data.to.name} />
        </>,
      ];
    case "task.transferred": {
      const { status, fields } = entry.data;
      return [
        "moved this task to another project",
        ...(status.from !== status.to
          ? [<>changed status <Status name={status.from} /> → <Status name={status.to} /></>]
          : []),
        ...updatedLines(fields),
      ];
    }
    case "task.archived":
      return ["archived this task"];
    case "task.unarchived":
      return ["unarchived this task"];
    case "comment.added":
      return [
        <>
          commented{" "}
          <span className="text-foreground">{entry.data.excerpt}</span>
        </>,
      ];
    default: {
      const unhandled: never = entry;
      void unhandled;
      return ["made a change"];
    }
  }
}

const DESCRIPTION_GROUP_WINDOW_MS = 10 * 60 * 1000;

function descriptionSave(entry: TaskActivityEntry | undefined) {
  if (entry?.type !== "task.updated") return;
  const { fields } = entry.data;
  if (fields.description?.to != null && Object.keys(fields).length === 1) {
    return fields.description;
  }
}

export function groupDescriptionActivity(entries: readonly TaskActivityEntry[]): TaskActivityEntry[] {
  const groups: TaskActivityEntry[] = [];
  let groupStartedAt = 0;

  // Core supplies events in chronological order, including ties.
  for (const entry of entries) {
    const previous = groups.at(-1);
    const previousSave = descriptionSave(previous);
    const save = descriptionSave(entry);
    const time = entry.createdAt.getTime();

    if (
      previous && previousSave && save &&
      previous.actor.id === entry.actor.id &&
      previous.source === entry.source &&
      previous.clientId === entry.clientId &&
      previous.clientName === entry.clientName &&
      time - groupStartedAt <= DESCRIPTION_GROUP_WINDOW_MS
    ) {
      groups[groups.length - 1] = {
        ...entry,
        type: "task.updated",
        data: { fields: { description: { from: previousSave.from, to: save.to } } },
      };
    } else {
      groups.push(entry);
      groupStartedAt = time;
    }
  }

  return groups;
}

function Row({ entry }: { entry: TaskActivityEntry }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5">
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        <span className="text-foreground">{entry.actor.displayName}</span>{" "}
        {describe(entry).map((line, i) => (
          // eslint-disable-next-line react/no-array-index-key -- one payload, fixed order
          <span key={i}>
            {i > 0 ? ", " : null}
            {line}
          </span>
        ))}
      </p>
      <SourceBadge source={entry.source} clientName={entry.clientName} />
      <span className="stutter numeral shrink-0">
        {shortDateTime(entry.createdAt)}
      </span>
    </li>
  );
}

/**
 * Never empty: `task.created` always exists, so this has no empty state (§4.12
 * lists one for comments and for the description, not for this).
 */
export function ActivityLog({ entries }: { entries: TaskActivityEntry[] }) {
  return (
    <ul className="divide-y divide-border/50">
      {[...entries].reverse().map((entry) => (
        <Row key={entry.id} entry={entry} />
      ))}
    </ul>
  );
}
