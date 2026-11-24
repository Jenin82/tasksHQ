"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { ProfileAvatar } from "@/components/profile-avatar";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { FieldPerson } from "./task-fields";

type Mention = { userId: string; start: number; end: number };
type Draft = { body: string; mentions: Mention[] };

function replaceText(draft: Draft, start: number, end: number, inserted: string): Draft {
  const shift = inserted.length - (end - start);
  return {
    body: draft.body.slice(0, start) + inserted + draft.body.slice(end),
    mentions: draft.mentions.flatMap((mention) => {
      if (mention.end <= start) return [mention];
      if (mention.start >= end) return [{ ...mention, start: mention.start + shift, end: mention.end + shift }];
      return [];
    }),
  };
}

function editText(draft: Draft, body: string, caret: number): Draft {
  if (draft.body === body) return draft;
  let oldEnd = draft.body.length;
  let newEnd = body.length;
  // Anchor the unchanged suffix at the caret. Repeated names otherwise make
  // it ambiguous which mention survived a deletion.
  while (newEnd > caret && oldEnd > 0 && draft.body[oldEnd - 1] === body[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  let start = 0;
  while (start < oldEnd && start < newEnd && draft.body[start] === body[start]) start++;
  return replaceText(draft, start, oldEnd, body.slice(start, newEnd));
}

function mentionQuery(draft: Draft, caret: number) {
  if (caret === 0) return null;
  const start = draft.body.lastIndexOf("@", caret - 1);
  if (start < 0 || /[\p{L}\p{N}_.@]$/u.test(draft.body.slice(0, start))) return null;
  if (draft.mentions.some((mention) => mention.start === start)) return null;
  const query = draft.body.slice(start + 1, caret);
  if (/\n/.test(query)) return null;
  return { start, query: query.trim().toLocaleLowerCase() };
}

export function CommentComposer({ people, pending, className }: {
  people: FieldPerson[];
  pending: boolean;
  className?: string;
}) {
  const id = useId();
  const listId = `${id}-mentions`;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const nextSelection = useRef<number | null>(null);
  const [draft, setDraft] = useState<Draft>({ body: "", mentions: [] });
  const [caret, setCaret] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [composing, setComposing] = useState(false);
  const query = caret === null || pending || composing ? null : mentionQuery(draft, caret);
  const options = query
    ? people.filter(({ name }) => name.trim() && name.toLocaleLowerCase().includes(query.query)).slice(0, 8)
    : [];
  const active = options[Math.min(activeIndex, options.length - 1)];

  function updateCaret(field: HTMLTextAreaElement) {
    const position = field.selectionStart === field.selectionEnd ? field.selectionStart : null;
    if (position === caret) return;
    setCaret(position);
    setActiveIndex(0);
  }

  function selectMention(person: FieldPerson) {
    if (!query || caret === null) return;
    const label = `@${person.name.trim()}`;
    const after = draft.body.slice(caret);
    const space = /^[\s,.!?;:)}\]]/.test(after) ? "" : " ";
    const edited = replaceText(draft, query.start, caret, label + space);
    const end = query.start + label.length;
    edited.mentions.push({ userId: person.userId, start: query.start, end });
    edited.mentions.sort((a, b) => a.start - b.start);
    nextSelection.current = end + (space || after.startsWith(" ") ? 1 : 0);
    setCaret(null);
    setDraft(edited);
  }

  useLayoutEffect(() => {
    if (nextSelection.current === null) return;
    const position = nextSelection.current;
    nextSelection.current = null;
    textarea.current?.focus();
    textarea.current?.setSelectionRange(position, position);
  }, [draft]);

  return (
    <>
      <Label htmlFor={id} className="stutter">Add a comment</Label>
      <input type="hidden" name="mentions" value={JSON.stringify(draft.mentions)} />
      <div className="relative">
        <textarea
          ref={textarea}
          id={id}
          name="body"
          required
          rows={3}
          value={draft.body}
          readOnly={pending}
          placeholder={people.length ? "Use @ to mention someone" : undefined}
          aria-autocomplete={people.length ? "list" : undefined}
          aria-controls={active ? listId : undefined}
          aria-activedescendant={active ? `${listId}-${active.userId}` : undefined}
          className={className}
          onFocus={(event) => updateCaret(event.currentTarget)}
          onBlur={() => setCaret(null)}
          onSelect={(event) => updateCaret(event.currentTarget)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onChange={(event) => {
            const field = event.currentTarget;
            setDraft(editText(draft, field.value, field.selectionStart));
            updateCaret(field);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (!active || event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const direction = event.key === "ArrowDown" ? 1 : -1;
              const index = options.indexOf(active);
              setActiveIndex((index + direction + options.length) % options.length);
            } else if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
              event.preventDefault();
              selectMention(active);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setCaret(null);
            }
          }}
        />
        {active && (
          <ul
            id={listId}
            role="listbox"
            aria-label="People to mention"
            className="absolute inset-x-0 bottom-full z-20 mb-1 max-w-xs overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-subtle"
          >
            {options.map((person, index) => (
              <li
                key={person.userId}
                id={`${listId}-${person.userId}`}
                role="option"
                aria-selected={person.userId === active.userId}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted",
                  person.userId === active.userId && "bg-muted",
                )}
                onPointerEnter={() => setActiveIndex(index)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => selectMention(person)}
              >
                <ProfileAvatar name={person.name} image={person.image} className="size-6 bg-muted text-xs" />
                <span className="min-w-0 truncate">{person.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
