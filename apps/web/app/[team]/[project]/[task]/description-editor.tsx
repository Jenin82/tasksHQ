"use client";

import { useEffect, useRef, useState } from "react";
import { Bold, Code, Heading2, ImagePlus, Italic, List, ListChecks, LoaderCircle } from "lucide-react";
import type { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { selectDescriptionLines } from "@/lib/description-formatting";
import { createDescriptionMarked } from "@/lib/description-markdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MAX_TASK_IMAGE_BYTES, TASK_IMAGE_ID } from "@tasks/core/task-images";

const ACCEPTED_IMAGES = "image/png,image/jpeg,image/webp,image/gif,image/avif";
const DESCRIPTION_STYLES = "[&_.tiptap>*+*]:mt-3 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_code]:rounded-sm [&_code]:bg-input [&_code]:px-1 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:font-semibold [&_img]:max-w-full [&_img]:rounded-md [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_ul]:list-disc [&_ul]:pl-5 [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_ul[data-type=taskList]>li]:flex [&_ul[data-type=taskList]>li]:gap-2 [&_ul[data-type=taskList]>li>label]:flex [&_ul[data-type=taskList]>li>label]:h-[1lh] [&_ul[data-type=taskList]>li>label]:items-center [&_ul[data-type=taskList]>li>div]:min-w-0 [&_ul[data-type=taskList]>li>div]:flex-1 [&_ul[data-type=taskList]>li_input]:size-4 [&_ul[data-type=taskList]>li_input]:accent-foreground [&_li[data-checked=true]>div]:text-muted-foreground [&_li[data-checked=true]>div]:line-through";
const PLACEHOLDER_STYLES = "[&_p.is-editor-empty:first-child::before]:pointer-events-none [&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:text-muted-foreground [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]";
const TOOLS = [
  { label: "Bold", icon: Bold, active: (editor: Editor) => editor.isActive("bold"), apply: (editor: Editor) => editor.chain().focus().toggleBold().run() },
  { label: "Italic", icon: Italic, active: (editor: Editor) => editor.isActive("italic"), apply: (editor: Editor) => editor.chain().focus().toggleItalic().run() },
  { label: "Heading", icon: Heading2, active: (editor: Editor) => editor.isActive("heading", { level: 2 }), apply: (editor: Editor) => editor.chain().focus().command(selectDescriptionLines).toggleHeading({ level: 2 }).run() },
  { label: "Bulleted list", icon: List, active: (editor: Editor) => editor.isActive("bulletList"), apply: (editor: Editor) => editor.chain().focus().command(selectDescriptionLines).toggleBulletList().run() },
  { label: "Checklist", icon: ListChecks, active: (editor: Editor) => editor.isActive("taskList"), apply: (editor: Editor) => editor.chain().focus().command(selectDescriptionLines).toggleTaskList().run() },
  { label: "Inline code", icon: Code, active: (editor: Editor) => editor.isActive("code"), apply: (editor: Editor) => editor.chain().focus().toggleCode().run() },
];

function sanitizePastedHtml(html: string, isProjectImage: (path: string) => boolean) {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const node of template.content.querySelectorAll("*")) {
    if (node.matches("script, style, link, base, iframe, object, embed, video, audio, source, track, svg, math, template, input, noscript, textarea, xmp, plaintext, title")) {
      node.remove();
      continue;
    }
    const image = node.tagName === "IMG";
    if (image && !isProjectImage(node.getAttribute("src") ?? "")) {
      node.replaceWith(document.createTextNode(node.getAttribute("alt") ?? ""));
      continue;
    }
    for (const name of node.getAttributeNames()) {
      if (
        (image && ["src", "alt", "title"].includes(name)) ||
        (node.tagName === "A" && ["href", "title"].includes(name)) ||
        (node.tagName === "OL" && name === "start")
      ) continue;
      node.removeAttribute(name);
    }
  }
  return template.innerHTML;
}

export function DescriptionEditor({
  value,
  onChange,
  imagesPath,
  onUploadChange,
  readOnly = false,
}: {
  value: string;
  imagesPath: string;
} & ({ readOnly: true; onChange?: never; onUploadChange?: never } | {
  readOnly?: false;
  onChange: (value: string) => void;
  onUploadChange: (uploading: boolean) => void;
})) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<File | null>(null);
  const [descriptionMarked] = useState(createDescriptionMarked);
  const picker = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const editorValue = useRef(value);
  const busy = uploading;

  function isProjectImage(path: string) {
    const prefix = `${imagesPath}/`;
    return path.startsWith(prefix) && TASK_IMAGE_ID.test(path.slice(prefix.length));
  }

  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly && !busy,
    extensions: [
      StarterKit.configure({ link: { openOnClick: readOnly } }),
      TaskList,
      // Read-only checklists show state without inviting a click.
      TaskItem.extend({
        addNodeView() {
          const view = this.parent?.();
          if (!view) return null;
          return (props) => {
            const nodeView = view(props);
            const checkbox = (nodeView.dom as HTMLElement).querySelector("input");
            if (!checkbox) return nodeView;
            // The description form resets after each save, which would put
            // every box back to its default. Keep the default in step.
            checkbox.defaultChecked = props.node.attrs.checked;
            if (readOnly) checkbox.disabled = true;
            const update = nodeView.update;
            nodeView.update = (node, ...rest) => {
              const updated = update?.call(nodeView, node, ...rest) ?? false;
              if (updated) checkbox.defaultChecked = node.attrs.checked;
              return updated;
            };
            return nodeView;
          };
        },
      }).configure({ nested: true }),
      Markdown.configure({ marked: descriptionMarked }),
      Placeholder.configure({ placeholder: "Describe the task. You can paste an image here." }),
      Image.extend({
        renderHTML({ node, HTMLAttributes }) {
          if (typeof node.attrs.src !== "string" || !isProjectImage(node.attrs.src)) {
            return ["span", { "aria-label": "Image unavailable" }, node.attrs.alt || "Image unavailable"];
          }
          return ["img", { ...HTMLAttributes, loading: "lazy" }];
        },
      }),
    ],
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: readOnly ? { class: "text-base leading-relaxed wrap-anywhere" } : {
        role: "textbox",
        "aria-label": "Description",
        "aria-multiline": "true",
        class: "min-h-24 px-3 py-2 text-base leading-relaxed wrap-anywhere outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      },
      transformPastedHTML: (html) => sanitizePastedHtml(html, isProjectImage),
      handleDOMEvents: {
        paste: (_view, event) => {
          if (readOnly) return false;
          const image = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith("image/"));
          if (!image) return false;
          event.preventDefault();
          void upload(image);
          return true;
        },
      },
    },
    onUpdate: ({ editor: current, transaction }) => {
      // Focusing can add a trailing paragraph to make the end editable.
      if (!transaction.docChanged) return;
      const markdown = current.getMarkdown();
      editorValue.current = markdown;
      onChange?.(markdown);
    },
  });

  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => current ? TOOLS.map((tool) => tool.active(current)) : [],
  });

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    editor?.setEditable(!readOnly && !busy, false);
  }, [busy, editor, readOnly]);
  useEffect(() => {
    if (!editor || value.trim() === editorValue.current.trim()) return;
    editorValue.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  async function upload(file: File) {
    if (request.current || !editor) return;
    setError("");
    setRetry(null);
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    if (file.size > MAX_TASK_IMAGE_BYTES) {
      setError("Choose an image that is 5 MB or smaller.");
      return;
    }

    const controller = new AbortController();
    const { doc, selection } = editor.state;
    request.current = controller;
    setUploading(true);
    onUploadChange?.(true);
    try {
      const response = await fetch(imagesPath, {
        method: "POST",
        body: file,
        signal: controller.signal,
      });
      if (response.status === 400) {
        const { error: message } = await response.json() as { error?: string };
        setError(message || "Couldn’t upload the image.");
        return;
      }
      if (!response.ok) throw new Error("Image upload failed");
      const { path } = await response.json() as { path?: string };
      if (!path || !isProjectImage(path)) throw new Error("Unexpected image path");
      if (controller.signal.aborted || editor.isDestroyed) return;
      const position = editor.state.doc === doc
        ? { from: selection.from, to: selection.to }
        : editor.state.doc.content.size;
      editor.commands.insertContentAt(position, {
        type: "image",
        attrs: { src: path, alt: "Image" },
      });
    } catch {
      if (!controller.signal.aborted) {
        setError("Couldn’t upload the image.");
        setRetry(file);
      }
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setUploading(false);
        onUploadChange?.(false);
      }
    }
  }

  if (readOnly) {
    return <EditorContent role="region" aria-label="Description" editor={editor} className={DESCRIPTION_STYLES} />;
  }

  return (
    <div className="min-w-0 rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1" role="group" aria-label="Description formatting">
        {TOOLS.map(({ label, icon: Icon, apply }, index) => (
          <Button
            key={label}
            type="button"
            variant={active?.[index] ? "secondary" : "ghost"}
            size="icon-sm"
            className="size-11 rounded-md sm:size-7"
            aria-label={label}
            aria-pressed={active?.[index] ?? false}
            title={label}
            disabled={busy || !editor}
            onClick={() => { if (editor) apply(editor); }}
          >
            <Icon aria-hidden />
          </Button>
        ))}
        <Button type="button" variant="ghost" size="icon-sm" className="size-11 rounded-md sm:size-7" aria-label="Add image" title="Add image" disabled={busy || !editor} onClick={() => picker.current?.click()}>
          <ImagePlus aria-hidden />
        </Button>
      </div>
      <input type="hidden" name="description" value={value} />
      <input
        ref={picker}
        type="file"
        accept={ACCEPTED_IMAGES}
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void upload(file);
        }}
      />
      <EditorContent
        editor={editor}
        className={cn("min-h-24", DESCRIPTION_STYLES, PLACEHOLDER_STYLES)}
      />
      {uploading && (
        <p role="status" className="flex items-center gap-2 border-t border-border px-3 py-2 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
          Uploading image…
        </p>
      )}
      {error && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <p role="alert" className="text-sm text-destructive">{error}</p>
          {retry && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void upload(retry)}>Retry</Button>}
        </div>
      )}
    </div>
  );
}
