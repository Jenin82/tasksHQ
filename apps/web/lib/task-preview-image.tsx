import { ImageResponse } from "next/og";
import { compactPreviewText, taskPreviewSize, type TaskPreview } from "@/lib/task-preview";
import { taskPreviewAvatar } from "@/lib/task-preview-avatar";

const statusColors = {
  gray: "#8f8f8f",
  blue: "#0063e1",
  green: "#54c68a",
  red: "#d9474c",
  yellow: "#f2ce55",
  orange: "#fb9a55",
  purple: "#c19af6",
  pink: "#f28dbb",
};

// ImageResponse runs in the server component runtime. Inline paths let its
// SVG renderer draw the card glyphs without loading client icon components.
const taskGlyphs = {
  task: "M9 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3 M9 3h6v4H9z M8 12h8m-8 5h8",
  bug: "m9 4 2 3m4-3-2 3M4 12h4m8 0h4M4 17l4-2m8 0 4 2M5 7l4 3m6 0 4-3M12 12v9M8 12v4a4 4 0 0 0 8 0v-4a4 4 0 0 0-8 0z",
  feature: "M11 2l1.6 6.4L19 10l-6.4 1.6L11 18l-1.6-6.4L3 10l6.4-1.6zM20 2v5m-2.5-2.5h5M5 17v5m-2.5-2.5h5",
  book: "M12 6v15M3 4h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3z",
  wrench: "M20 3a6 6 0 0 1-7 9l-8 8a2 2 0 1 1-3-3l8-8a6 6 0 0 1 9-7l-4 4 3 3 4-4",
  flag: "M5 22V3m0 1c5-5 9 4 15-1v12c-6 5-10-4-15 1",
  star: "m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z",
  lightning: "m13 2-9 12h7l-1 8 10-13h-7z",
} satisfies Record<TaskPreview["type"]["icon"], string>;

const priorityStyles = {
  low: { glyph: "m6 7 6 6 6-6M6 13l6 6 6-6", color: "#8f8f8f" },
  medium: { glyph: "M6 9h12M6 15h12", color: "#fbbf24" },
  high: { glyph: "m6 11 6-6 6 6M6 17l6-6 6 6", color: "#d9474c" },
};

const badge = {
  display: "flex",
  alignItems: "center",
  height: 90,
  border: "4px solid #292929",
} as const;

function cardText(text: string, limit: number, fallback: string) {
  // The bundled font covers these glyphs. @vercel/og fetches remote font
  // subsets based on the text when it encounters unsupported characters.
  const localText = text.normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/[^\x20-\x7e\s]+/g, " ");
  return compactPreviewText(localText, limit).replace(/…$/, "...") || fallback;
}

function CardGlyph({ path, size, color }: { path: string; size: number; color: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color}
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d={path} />
    </svg>
  );
}

export async function taskPreviewImage(task: TaskPreview, headers: Record<string, string>) {
  const title = cardText(task.title, 160, "Work item");
  const statusName = cardText(task.status.name, 30, "Status");
  const typeName = cardText(task.type.name, 24, "Task");
  const statusColor = statusColors[task.status.color ?? "gray"];
  const typeColor = statusColors[task.type.color ?? "gray"];
  const priority = priorityStyles[task.priority];
  const avatar = task.assignee ? await taskPreviewAvatar(task.assignee) : null;

  return new ImageResponse(
    <div style={{
      display: "flex",
      width: "100%",
      height: "100%",
      backgroundColor: "#141414",
      color: "#f9f9f9",
      padding: "24px 42px",
    }}>
      <div style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: "#0f0f0f",
        border: `4px solid ${statusColor}AA`,
        borderRadius: 36,
        padding: "57px 49px 39px",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: "#969696", fontSize: task.key.length > 11 ? 40 : 50, fontWeight: 500 }}>{task.key}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
            <div style={{ ...badge, gap: 20, padding: "0 25px", borderRadius: 17, color: "#969696", fontSize: 48, fontWeight: 500 }}>
              <CardGlyph path={taskGlyphs[task.type.icon]} size={60} color={typeColor} />
              <span style={{ maxWidth: 330, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{typeName}</span>
            </div>
            <div style={{ ...badge, justifyContent: "center", width: 126, borderRadius: 25 }}>
              <CardGlyph path={priority.glyph} size={55} color={priority.color} />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", flexGrow: 1, padding: "18px 0" }}>
          <div style={{
            display: "block", width: "100%", fontSize: 61, fontWeight: 700,
            lineHeight: 1.2, letterSpacing: -1.1, lineClamp: 3, wordBreak: "break-word",
            WebkitTextStrokeWidth: "1px", WebkitTextStrokeColor: "#f9f9f9",
          }}>
            {title}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 104 }}>
          <div style={{ ...badge, gap: 26, padding: "0 25px", borderRadius: 26, fontSize: 49, fontWeight: 500 }}>
            <div style={{ display: "flex", width: 25, height: 25, borderRadius: 13, backgroundColor: statusColor }} />
            <span>{statusName}</span>
          </div>
          {task.assignee && (avatar ? (
            <img src={avatar} alt="" width={104} height={104} style={{ borderRadius: 52 }} />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 104, height: 104, borderRadius: 52, backgroundColor: "#242424" }}>
              <CardGlyph path="M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2" size={48} color="#a3a3a3" />
            </div>
          ))}
        </div>
      </div>
    </div>,
    { ...taskPreviewSize, headers },
  );
}
