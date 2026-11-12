import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { expect, it } from "vitest";
import { selectDescriptionLines } from "@/lib/description-formatting";
import { createDescriptionMarked } from "@/lib/description-markdown";

function makeEditor() {
  return new Editor({
    element: null,
    extensions: [StarterKit, Markdown.configure({ marked: createDescriptionMarked() })],
    content: "First\nSecond\nThird\nFourth",
    contentType: "markdown",
  });
}

it("applies a heading only to the line under the cursor", () => {
  const editor = makeEditor();
  editor.commands.setTextSelection(8);
  editor.chain().command(selectDescriptionLines).toggleHeading({ level: 2 }).run();
  expect(editor.getMarkdown()).toBe("First\n\n## Second\n\nThird  \nFourth");
  editor.destroy();
});

it("bullets selected lines without including the next line at the selection edge", () => {
  const editor = makeEditor();
  editor.commands.setTextSelection({ from: 7, to: 20 });
  editor.chain().command(selectDescriptionLines).toggleBulletList().run();
  expect(editor.getMarkdown()).toBe("First\n\n- Second\n- Third\n\nFourth");
  editor.destroy();
});
