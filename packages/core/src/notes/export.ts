import JSZip from "jszip";
import { stringify } from "yaml";
import type { Note } from "./index.js";

export interface ExportFrontmatter {
  title: string;
  tags: string[];
  /** Human-readable source (document title), omitted when unknown. */
  source?: string;
  exported_at: string;
}

export interface FormatExportOptions {
  source?: string;
  exportedAt?: Date | string;
}

/** Exported note: title / tags / source / exported_at frontmatter; body unchanged. */
export function formatExportedNote(note: Pick<Note, "title" | "tags" | "body">, opts: FormatExportOptions = {}): string {
  const exported_at = opts.exportedAt instanceof Date ? opts.exportedAt.toISOString() : (opts.exportedAt ?? new Date().toISOString());
  // Field order matches the export UI contract: title / tags / source / exported_at.
  const fm: ExportFrontmatter = opts.source
    ? { title: note.title, tags: note.tags, source: opts.source, exported_at }
    : { title: note.title, tags: note.tags, exported_at };
  return `---\n${stringify(fm).trimEnd()}\n---\n\n${note.body.replace(/^\n+/, "")}`;
}

/** Safe file base name from a note title (keeps CJK); falls back to `id`. */
export function noteFileName(title: string, id: string): string {
  const base = title
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/, "")
    .slice(0, 80);
  return `${base || id}.md`;
}

export interface ConversationExportMessage {
  role: "user" | "assistant";
  content: string;
  /** Quoted selection shown above the turn. */
  quote?: string;
  source?: string;
}

/** Conversation → a single markdown document (quote cards + Q/A). */
export function formatConversationMarkdown(title: string, messages: ConversationExportMessage[], exportedAt = new Date()): string {
  const fm = { title, exported_at: exportedAt.toISOString(), type: "conversation" };
  const parts = messages.map((m) => {
    const who = m.role === "user" ? "我" : "AI";
    const quote = m.quote?.trim()
      ? `> ${m.quote.trim().replace(/\n/g, "\n> ")}${m.source ? `\n>\n> — ${m.source}` : ""}\n\n`
      : "";
    return `### ${who}\n\n${quote}${m.content.trim()}\n`;
  });
  return `---\n${stringify(fm).trimEnd()}\n---\n\n# ${title}\n\n${parts.join("\n")}`.trimEnd() + "\n";
}


export interface NoteExportEntry {
  fileName: string;
  markdown: string;
}

/** Build a zip of exported notes (DEFLATE). Pure: no filesystem. */
export async function zipExportedNotes(entries: NoteExportEntry[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const used = new Set<string>();
  for (const e of entries) {
    let name = e.fileName.endsWith(".md") ? e.fileName : `${e.fileName}.md`;
    if (used.has(name)) {
      const stem = name.slice(0, -3);
      let i = 2;
      while (used.has(`${stem}-${i}.md`)) i++;
      name = `${stem}-${i}.md`;
    }
    used.add(name);
    zip.file(name, e.markdown);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
