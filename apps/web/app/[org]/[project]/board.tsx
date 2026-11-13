"use client";

import { InlineTaskField, TaskTypeEditContext } from "./table/inline-task-field";
import { useContext, useId, useOptimistic, useRef, useState, useTransition } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type Active,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type Over,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TaskSummary, TaskTypeRef } from "@tasks/core/domain";
import type { Status, TaskPriority } from "@tasks/core/schema";
import { ProfileAvatar } from "@/components/profile-avatar";
import { ProjectTabFilters } from "@/components/tab-link";
import { TaskTypeBadge } from "@/components/task-type";
import { TaskPriorityIcon, taskPriorityLabel } from "@/components/task-priority";
import { statusColorClass, statusDot } from "@/lib/status-style";
import { formatTaskDueDate, isPastTaskDueDate } from "@/lib/task-due-date";
import { cn } from "@/lib/utils";
import { moveTaskAction } from "./actions";
import { AddTask } from "./add-task";
import { useOpenTaskDialog } from "./task-dialog-context";
import { TaskPeopleFilters, useTaskPeopleFilters } from "./task-people-filters";

export type BoardStatus = Pick<Status, "id" | "name" | "color">;

export type BoardCard = Pick<TaskSummary, "assignee" | "createdBy" | "reportedBy"> & {
  id: string;
  key: string;
  title: string;
  statusId: string;
  dueDate: string | null;
  priority: TaskPriority;
  type: TaskTypeRef;
  updated: string;
  canEdit?: boolean;
};

/** A place on the board: a column, and the slot in it a card would take. */
type Slot = { statusId: string; index: number };

type Move = { taskId: string; statusId: string; afterTaskId: string | null };

/** §7.6: a card settles in 200ms; everything else is a 140ms state change. */
const SETTLE = { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" };

const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

/** The gap between cards, so a keyboard cursor can sit past the last one. */
const CARD_GAP = 8;
const CARD_SURFACE = "rounded-lg px-3 py-2.5 text-sm shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--status-color)_65%,transparent)]";

/**
 * A column's droppable spans its whole height, so by corner distance a card in
 * the next column outscores the column the cursor is actually inside — which
 * would make an empty column unreachable with the mouse. `pointerWithin` ranks
 * only what the cursor is genuinely over, and ranks a card above the column
 * holding it. It returns nothing for the keyboard sensor, which has no
 * pointer, so that path falls back to corner distance.
 */
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : closestCorners(args);
};

function column(cards: BoardCard[], statusId: string) {
  return cards.filter((c) => c.statusId === statusId);
}

/** Translate a visible drop slot into the canonical destination order. */
export function resolveVisibleMove(cards: BoardCard[], visible: BoardCard[], card: BoardCard, place: Slot): Move | null {
  // Dropping into the same visible slot must not move past hidden tasks.
  if (
    place.statusId === card.statusId &&
    place.index === column(visible, card.statusId).findIndex((c) => c.id === card.id)
  ) {
    return null;
  }

  // The visible slot names the next visible task. Insert immediately before
  // it in the full column, or append to the full column at its visible end.
  const next = column(visible, place.statusId).filter((c) => c.id !== card.id)[place.index];
  const destination = column(cards, place.statusId).filter((c) => c.id !== card.id);
  const index = next ? destination.findIndex((c) => c.id === next.id) : destination.length;
  const afterTaskId = index > 0 ? destination[index - 1].id : null;
  return { taskId: card.id, statusId: place.statusId, afterTaskId };
}

/**
 * The optimistic move, in the same terms the Server Action takes: place
 * `taskId` in `statusId` directly after `afterTaskId`. No fractional key is
 * computed here — that is the domain layer's job (§3).
 */
function placeCard(cards: BoardCard[], move: Move): BoardCard[] {
  const moving = cards.find((c) => c.id === move.taskId);
  if (!moving) return cards;

  const rest = cards.filter((c) => c.id !== move.taskId);
  const placed = { ...moving, statusId: move.statusId };

  if (move.afterTaskId === null) {
    const first = rest.findIndex((c) => c.statusId === move.statusId);
    return first === -1
      ? [...rest, placed]
      : [...rest.slice(0, first), placed, ...rest.slice(first)];
  }

  const after = rest.findIndex((c) => c.id === move.afterTaskId);
  return [...rest.slice(0, after + 1), placed, ...rest.slice(after + 1)];
}

export function Board({
  orgSlug,
  projectSlug,
  statuses,
  cards: serverCards,
}: {
  orgSlug: string;
  projectSlug: string;
  statuses: BoardStatus[];
  cards: BoardCard[];
}) {
  const [cards, applyMove] = useOptimistic(serverCards, placeCard);
  const filters = useTaskPeopleFilters(cards);
  const visible = filters.visible;
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // A keyboard drag carries its own cursor instead of reading `over`.
  // dnd-kit's list coordinate getter is written for one list: on this board it
  // walks a card down its own column when Right is pressed, and it cannot
  // reach an empty column at all. Null for the whole of a pointer drag, which
  // is how the two paths tell themselves apart.
  const slot = useRef<Slot | null>(null);
  // The sensor's coordinate getter outlives any one render, so it reads cards
  // through a ref rather than closing over a stale array.
  const latest = useRef(visible);
  latest.current = visible;

  const siblingsOf = (statusId: string, selfId: string) =>
    column(latest.current, statusId).filter((c) => c.id !== selfId);

  const keyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
    const { active, droppableRects } = context;
    const here = slot.current;
    if (!active || !here || !ARROWS.includes(event.code)) return;
    event.preventDefault();

    const self = String(active.id);
    const columnIndex = statuses.findIndex((s) => s.id === here.statusId);
    let { statusId, index } = here;

    if (event.code === "ArrowUp") {
      index = Math.max(0, index - 1);
    } else if (event.code === "ArrowDown") {
      index = Math.min(siblingsOf(statusId, self).length, index + 1);
    } else {
      const next = statuses[columnIndex + (event.code === "ArrowLeft" ? -1 : 1)];
      if (!next) return;
      statusId = next.id;
      index = Math.min(index, siblingsOf(statusId, self).length);
    }
    slot.current = { statusId, index };

    // The sensor wants the absolute position the card should occupy.
    const siblings = siblingsOf(statusId, self);
    const target = siblings[index];
    if (target) {
      const rect = droppableRects.get(target.id);
      return rect && { x: rect.left, y: rect.top };
    }
    // Past the last card — or an empty column, where the column's own
    // droppable is the only rect there is.
    const last = siblings.at(-1);
    const rect = droppableRects.get(last ? last.id : statusId);
    return (
      rect && {
        x: rect.left,
        y: last ? rect.top + rect.height + CARD_GAP : rect.top,
      }
    );
  };

  // Touch swipes can scroll the board before a hold starts dragging.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );

  /** Where a pointer drag ended, read off the geometry. */
  function pointerSlot(
    card: BoardCard,
    active: Active,
    over: Over | null,
  ): Slot | null {
    if (!over || over.id === active.id) return null;

    // `over` is either another card or a column's own droppable, which is how
    // an empty column stays a valid target.
    const overCard = visible.find((c) => c.id === over.id);
    const statusId = overCard ? overCard.statusId : String(over.id);
    if (!statuses.some((s) => s.id === statusId)) return null;

    const siblings = siblingsOf(statusId, card.id);
    if (!overCard) return { statusId, index: siblings.length };

    const overIndex = siblings.findIndex((c) => c.id === overCard.id);
    const self = active.rect.current.translated;
    const below = self
      ? self.top + self.height / 2 > over.rect.top + over.rect.height / 2
      : false;
    return { statusId, index: below ? overIndex + 1 : overIndex };
  }

  function onDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    setDragging(id);
    const card = cards.find((c) => c.id === id);
    slot.current =
      card && event.activatorEvent instanceof KeyboardEvent
        ? {
            statusId: card.statusId,
            index: column(visible, card.statusId).findIndex((c) => c.id === id),
          }
        : null;
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const here = slot.current;
    setDragging(null);
    slot.current = null;

    const card = cards.find((c) => c.id === active.id);
    if (!card || card.canEdit === false) return;

    const place = here ?? pointerSlot(card, active, over);
    if (!place) return;

    const move = resolveVisibleMove(cards, visible, card, place);
    if (!move) return;
    startTransition(async () => {
      applyMove(move);
      const result = await moveTaskAction({ orgSlug, projectSlug, ...move });
      setError(result.error ?? null);
    });
  }

  const active = dragging ? cards.find((c) => c.id === dragging) : null;

  // dnd-kit's defaults announce raw ids, which are UUIDs here and useless read
  // aloud. Same two registers the card uses: a key and a column name.
  const name = (id: string | number) =>
    cards.find((c) => c.id === id)?.key ??
    statuses.find((s) => s.id === id)?.name ??
    String(id);
  const where = (activeId: string | number, over: Over | null) => {
    const here = slot.current;
    if (!here) return over ? `over ${name(over.id)}` : "outside every column";
    const next = siblingsOf(here.statusId, String(activeId))[here.index];
    const columnName = statuses.find((s) => s.id === here.statusId)?.name ?? "";
    return next
      ? `before ${next.key} in ${columnName}`
      : `at the end of ${columnName}`;
  };
  const announcements = {
    onDragStart: ({ active }: { active: Active }) =>
      `Picked up ${name(active.id)}.`,
    // A keyboard move can change the slot without changing `over` — the step
    // past the last card in a column is exactly that — so the keyboard is
    // announced on every move and the pointer only when the target changes.
    onDragMove: ({ active, over }: { active: Active; over: Over | null }) =>
      slot.current ? `${name(active.id)} ${where(active.id, over)}.` : undefined,
    onDragOver: ({ active, over }: { active: Active; over: Over | null }) =>
      `${name(active.id)} ${where(active.id, over)}.`,
    onDragEnd: ({ active }: { active: Active }) =>
      `Dropped ${name(active.id)}.`,
    onDragCancel: ({ active }: { active: Active }) =>
      `Left ${name(active.id)} where it was.`,
  };

  return (
    <DndContext
      // Stable, or dnd-kit's module-level counter numbers the screen-reader
      // description differently on the server and the client and React logs a
      // hydration mismatch on every card.
      id="board"
      accessibility={{ announcements }}
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragging(null);
        slot.current = null;
      }}
    >
      <ProjectTabFilters view="board" count={visible.length} activeCount={filters.activeCount}>
        <TaskPeopleFilters filters={filters} statuses={statuses} disabled={dragging !== null} />
      </ProjectTabFilters>
      <div
        role="region"
        aria-label="Task board"
        data-task-list
        tabIndex={0}
        className="flex min-w-0 flex-1 flex-col overflow-x-auto p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {error ? (
          <p role="alert" className="mb-6 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="grid min-h-[65dvh] flex-1 auto-cols-[minmax(17rem,1fr)] grid-flow-col gap-3 xl:min-h-[calc(100dvh-8.75rem)]">
          {statuses.map((status) => (
            <Column
              key={status.id}
              status={status}
              cards={column(visible, status.id)}
              filtered={filters.active}
              orgSlug={orgSlug}
              projectSlug={projectSlug}
            />
          ))}
        </div>
      </div>

      {/* §7.6: lift — the popover surface and 1.02 scale, never rotation or
          a drop shadow (§7.2). */}
      <DragOverlay dropAnimation={SETTLE}>
        {active ? (
          <div className={cn(
            CARD_SURFACE,
            statusColorClass(statuses.find((s) => s.id === active.statusId)?.color ?? null),
            "scale-[1.02] bg-popover text-popover-foreground [&_.stutter]:text-foreground/70",
          )}>
            <CardFace card={active} status={statuses.find((status) => status.id === active.statusId)} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  cards,
  filtered,
  orgSlug,
  projectSlug,
}: {
  status: BoardStatus;
  cards: BoardCard[];
  filtered: boolean;
  orgSlug: string;
  projectSlug: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });
  const base = `/${orgSlug}/${projectSlug}`;

  return (
    <section
      aria-label={status.name}
      className="group/status flex min-w-0 flex-col rounded-xl bg-muted/65 p-2.5"
    >
      {/* §7.1: the count sits at the far edge, never `In Progress (12)`. */}
      <header className="flex items-center gap-2 px-1 pb-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              statusDot(status.color),
            )}
          />
          <span className="text-sm font-semibold wrap-anywhere">{status.name}</span>
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">{cards.length}</span>
      </header>

      <SortableContext
        items={cards.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className={cn(
            "flex min-h-32 flex-1 flex-col gap-2 rounded-md p-1 transition-colors",
            isOver && "bg-accent/50",
          )}
        >
          {cards.length === 0 ? (
            // §7.3: an empty-state line is the calm register. The 12px mono
            // stutter is for keys, labels and timestamps.
            <p className="px-2 py-3 text-base text-muted-foreground">
              {filtered ? "No matching tasks" : "No tasks"}
            </p>
          ) : (
            cards.map((card) => (
              <SortableCard key={card.id} card={card} status={status} base={base} />
            ))
          )}

          {/* Inside the droppable so it follows the last card rather than the
              tallest column. Safe: drag listeners are spread on cards only, so
              neither a click nor typing here can lift one. */}
          <AddTask
            orgSlug={orgSlug}
            projectSlug={projectSlug}
            statusId={status.id}
            statusName={status.name}
          />
        </div>
      </SortableContext>
    </section>
  );
}

function SortableCard({ card, status, base }: { card: BoardCard; status: BoardStatus; base: string }) {
  const canEdit = card.canEdit !== false;
  const typeEditor = useContext(TaskTypeEditContext);
  const canEditFields = canEdit && typeEditor !== null;
  // The wrapper is both the dragged node and the drag activator. Setting the
  // activator ref is what arms dnd-kit's KeyboardSensor guard: it starts a
  // drag on Space/Enter only when `event.target` *is* the activator. The
  // inner button opens the dialog, and the focused wrapper still lifts it.
  //
  // The group carries the sortable role description and drag instructions.
  // A button has no native navigation to follow after a drag suppresses clicks.
  const open = useOpenTaskDialog();
  const metadataId = useId();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    disabled: { draggable: !canEdit },
    transition: SETTLE,
    attributes: { role: "group" },
  });

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setActivatorNodeRef(canEdit ? node : null);
      }}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...(canEdit ? attributes : { role: "group" })}
      {...(canEdit ? listeners : undefined)}
      aria-label={`${card.key} ${card.title}`}
      className={cn(
        "relative rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isDragging && "opacity-40",
      )}
    >
      <button
        type="button"
        aria-label={`Open ${card.key} ${card.title}`}
        aria-describedby={metadataId}
        aria-haspopup="dialog"
        className={cn(
          CARD_SURFACE,
          statusColorClass(status.color),
          // Contain the absolute sr-only metadata within the board's scroller.
          "relative block w-full cursor-pointer bg-card text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
        )}
        onClick={(event) => open?.({
          href: `${base}/${card.key}`,
          key: card.key,
          title: card.title,
          status,
          assignee: card.assignee?.displayName ?? null,
          updated: card.updated,
          dueDate: card.dueDate,
          priority: card.priority,
          type: card.type,
        }, event.currentTarget)}
      >
        <CardFace card={card} status={status} inlineFields={canEditFields} />
        <span id={metadataId} className="sr-only">
          Type {card.type.name}. {taskPriorityLabel(card.priority)} priority.
          {card.dueDate && ` Due ${formatTaskDueDate(card.dueDate)}.`}
          {card.assignee && ` Assigned to ${card.assignee.displayName}.`}
        </span>
      </button>
      {canEditFields && (
        <div
          className="absolute top-2.5 right-3 flex max-w-[65%] items-start"
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="min-w-0">
            <InlineTaskField task={card} field="typeId" value={card.type.id}>
              <TaskTypeBadge type={card.type} />
            </InlineTaskField>
          </div>
          <div className="shrink-0">
            <InlineTaskField task={card} field="priority" value={card.priority} priorityIconOnly>
              <CardPriority priority={card.priority} />
            </InlineTaskField>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * §7.3: the card's rhythm is the two registers alternating — quiet mono key,
 * calm sentence-case title, quiet mono footer. Nothing sits between them.
 * §7.2: the card surface and its inset hairline, 12px — tighter than §7.4's
 * 16px card radius, which reads as a bubble at this size.
 */
function CardFace({ card, status, inlineFields }: { card: BoardCard; status?: BoardStatus; inlineFields?: boolean }) {
  return (
    <>
      <span className={cn("flex items-center justify-between gap-2", inlineFields && "min-h-8")}>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{card.key}</span>
        {!inlineFields && <TaskTypeBadge type={card.type} />}
      </span>
      <span className="mt-1.5 block font-medium leading-snug wrap-anywhere">{card.title}</span>
      <span className="mt-2.5 flex items-center justify-between gap-4">
        <span className="flex flex-wrap items-center gap-1.5 text-xs">
          {status && <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-1.5 py-0.5">
            <span aria-hidden className={cn("size-1.5 rounded-full", statusDot(status.color))} />
            {status.name}
          </span>}
          {!inlineFields && <CardPriority priority={card.priority} />}
          {card.dueDate && (
            <time dateTime={card.dueDate} className={cn("rounded-md border border-border px-1.5 py-0.5 tabular-nums", isPastTaskDueDate(card.dueDate) && "text-destructive")}>
              Due {formatTaskDueDate(card.dueDate)}
            </time>
          )}
        </span>
        {card.assignee ? (
          <ProfileAvatar name={card.assignee.displayName} image={card.assignee.image} className="stutter size-6" />
        ) : null}
      </span>
    </>
  );
}

function CardPriority({ priority }: { priority: TaskPriority }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border px-1.5 py-0.5">
      <TaskPriorityIcon priority={priority} />
    </span>
  );
}
