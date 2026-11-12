import { Node } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { expect, it } from "vitest";
import { createDescriptionMarked } from "@/lib/description-markdown";

function manager() {
  return new MarkdownManager({ marked: createDescriptionMarked(), extensions: [StarterKit] });
}

it("keeps old tables and checklist markers visible when editing a description", () => {
  const markdown = manager();
  const doc = markdown.parse(
    "| Work | Status |\n| --- | --- |\n| Setup | Done |\n\n- [x] **Finished**\n- [ ] Open",
  );

  expect(doc.content?.[0]).toEqual({
    type: "paragraph",
    content: [
      { type: "text", text: "| Work | Status |" },
      { type: "hardBreak" },
      { type: "text", text: "| --- | --- |" },
      { type: "hardBreak" },
      { type: "text", text: "| Setup | Done |" },
    ],
  });
  const list = {
    type: "bulletList",
    content: [
      {
        type: "listItem",
        content: [{
          type: "paragraph",
          content: [
            { type: "text", text: "[x] " },
            { type: "text", text: "Finished", marks: [{ type: "bold" }] },
          ],
        }],
      },
      {
        type: "listItem",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: "[ ] Open" }],
        }],
      },
    ],
  };
  expect(doc.content?.[1]).toEqual(list);
  expect(markdown.parse(markdown.serialize(doc)).content?.[1]).toEqual(list);
});

it("keeps inline and block HTML as literal text on parse and save", () => {
  const markdown = manager();
  const inline = "Keep <strong>literal</strong> and <img src=x onerror=alert(1)> inline.";
  const doc = markdown.parse(`${inline}\n\n<div>\n  <script>alert(1)</script>\n</div>`);

  expect(doc.content).toEqual([
    { type: "paragraph", content: [{ type: "text", text: inline }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "<div>" },
        { type: "hardBreak" },
        { type: "text", text: "  <script>alert(1)</script>" },
        { type: "hardBreak" },
        { type: "text", text: "</div>" },
      ],
    },
  ]);
  const saved = markdown.serialize(doc);
  expect(saved).not.toContain("<script>");
  expect(markdown.parse(saved)).toEqual(doc);
});

it("retains formatting, inline code and single line breaks", () => {
  const markdown = manager();
  const doc = markdown.parse("## Title\n\n**bold** and *italic* plus `<code>`\nold line break");

  expect(doc.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 2 } });
  expect(doc.content?.[1]?.content).toEqual(expect.arrayContaining([
    { type: "text", text: "bold", marks: [{ type: "bold" }] },
    { type: "text", text: "italic", marks: [{ type: "italic" }] },
    { type: "text", text: "<code>", marks: [{ type: "code" }] },
    { type: "hardBreak" },
    { type: "text", text: "old line break" },
  ]));
  expect(markdown.parse(markdown.serialize(doc))).toEqual(doc);
});

it("isolates tokenizers registered by different editor instances", () => {
  const first = manager();
  const second = manager();
  const source = "[[badge]]";
  first.registerExtension(Node.create({
    name: "descriptionBadge",
    markdownTokenizer: {
      name: "descriptionBadge",
      level: "inline",
      start: source,
      tokenize: (input) => input.startsWith(source)
        ? { type: "descriptionBadge", raw: source }
        : undefined,
    },
    parseMarkdown: (_token, helpers) => helpers.createTextNode("Badge"),
  }));

  expect(first.parse(source).content?.[0]?.content).toEqual([{ type: "text", text: "Badge" }]);
  for (const other of [second, manager()]) {
    expect([...other.instance.lexer(source)]).toMatchObject([
      { type: "paragraph", tokens: [{ type: "text", text: source }] },
    ]);
    expect(other.parse(source).content?.[0]?.content).toEqual([{ type: "text", text: source }]);
  }
});
