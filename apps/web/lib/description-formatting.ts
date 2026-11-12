import type { Command } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { canSplit } from "@tiptap/pm/transform";

// Markdown and Shift+Enter can put several visible lines in one paragraph.
// Make only the lines being formatted into separate blocks before toggling.
export const selectDescriptionLines: Command = ({ tr, dispatch }) => {
  const { from, to, $to, empty, anchor, head } = tr.selection;
  const endsAfterBreak = $to.nodeBefore?.type.name === "hardBreak";
  const end = !empty && (endsAfterBreak || $to.parentOffset === 0) ? to - 1 : to;
  const breaks: number[] = [];

  tr.doc.nodesBetween(from, end, (node, pos) => {
    if (node.type.name !== "paragraph" && node.type.name !== "heading") return;
    let before: number | undefined;
    let after: number | undefined;
    node.forEach((child, offset) => {
      if (child.type.name !== "hardBreak") return;
      const at = pos + 1 + offset;
      if (at < from) before = at;
      else if (at >= end) after ??= at;
      else breaks.push(at);
    });
    if (before !== undefined) breaks.push(before);
    if (after !== undefined) breaks.push(after);
    return false;
  });

  if (dispatch) {
    const mappingStart = tr.mapping.maps.length;
    for (const at of breaks.sort((a, b) => b - a)) {
      if (canSplit(tr.doc, at + 1)) tr.split(at + 1).delete(at, at + 1);
    }
    if (breaks.length || end !== to) {
      const mapping = tr.mapping.slice(mappingStart);
      const start = tr.doc.resolve(mapping.map(from));
      const finish = tr.doc.resolve(mapping.map(end));
      tr.setSelection(TextSelection.between(
        anchor <= head ? start : finish,
        anchor <= head ? finish : start,
      ));
    }
  }
  return true;
};
