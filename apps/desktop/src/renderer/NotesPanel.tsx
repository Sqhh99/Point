import { useEffect, useState } from "react";
import type { Note, NoteMeta } from "@point/core";
import { Markdown } from "./Markdown";

const api = window.point;

interface Props {
  current: string | null;
  onSelect(id: string | null): void;
  /** Bumped by the parent whenever notes change elsewhere (e.g. 插入笔记). */
  version: number;
  docId: string | null;
  docTitle: string | null;
}

export function NotesPanel({ current, onSelect, version, docId, docTitle }: Props) {
  const [list, setList] = useState<NoteMeta[]>([]);
  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [status, setStatus] = useState("");

  useEffect(() => {
    api.notes.list().then(setList, () => setList([]));
  }, [version]);

  useEffect(() => {
    setStatus("");
    if (!current) return setNote(null);
    api.notes.read(current).then(
      (n) => {
        setNote(n);
        setTitle(n.title);
        setBody(n.body);
      },
      () => onSelect(null)
    );
  }, [current, version, onSelect]);

  const dirty = !!note && (title !== note.title || body !== note.body);

  const save = async () => {
    if (!note) return;
    const n = await api.notes.update(note.id, { title, body });
    setNote(n);
    setList(await api.notes.list());
    setStatus("已保存");
  };

  const create = async () => {
    const n = await api.notes.create({ title: docTitle ? `${docTitle} · 笔记` : "新笔记", sourceDocId: docId ?? undefined });
    setList(await api.notes.list());
    setMode("edit");
    onSelect(n.id);
  };

  if (!note) {
    return (
      <div className="notes">
        <div className="notes-toolbar">
          <button onClick={() => void create()}>新建笔记</button>
        </div>
        <ul className="note-list" data-testid="note-list">
          {list.map((n) => (
            <li key={n.id}>
              <button className="doc" onClick={() => onSelect(n.id)}>
                <span className="doc-title">{n.title}</span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="empty">还没有笔记。对话里的回答可以一键“插入笔记”。</li>}
        </ul>
      </div>
    );
  }

  return (
    <div className="notes" data-testid="note-editor">
      <div className="notes-toolbar">
        <button className="link" onClick={() => onSelect(null)}>
          ‹ 全部笔记
        </button>
        <span className="push-right" />
        <button className="link" onClick={() => setMode(mode === "edit" ? "preview" : "edit")}>
          {mode === "edit" ? "预览" : "编辑"}
        </button>
        <button className="primary" disabled={!dirty} onClick={() => void save()}>
          保存
        </button>
      </div>
      <input className="note-title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="笔记标题" />
      {mode === "edit" ? (
        <textarea className="note-body" value={body} onChange={(e) => setBody(e.target.value)} aria-label="笔记内容" spellCheck={false} />
      ) : (
        <div className="note-preview">
          <Markdown text={body} />
        </div>
      )}
      <div className="hint note-status">{dirty ? "有未保存的修改" : status}</div>
    </div>
  );
}
