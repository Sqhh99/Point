import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskKind } from "@point/core";
import type { StoredMessage, TaskEvent } from "../shared/ipc";
import { Markdown } from "./Markdown";
import { NotesPanel } from "./NotesPanel";
import type { SelectionInfo } from "./Reader";

const api = window.point;

export interface TaskTrigger {
  seq: number;
  kind: TaskKind;
  sel: SelectionInfo;
}

interface Props {
  trigger: TaskTrigger | null;
  docId: string | null;
  docTitle: string | null;
  hasWorkspace: boolean;
  onOpenSettings(): void;
}

type Failure = { code: string; message: string };

export function AIPanel({ trigger, docId, docTitle, hasWorkspace, onOpenSettings }: Props) {
  const [tab, setTab] = useState<"chat" | "notes">("chat");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [draft, setDraft] = useState<{ requestId: string; text: string } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [attached, setAttached] = useState<SelectionInfo | null>(null);
  const [question, setQuestion] = useState("");
  const [noteId, setNoteId] = useState<string | null>(null);
  const [notesVersion, setNotesVersion] = useState(0);
  const [insertedId, setInsertedId] = useState<string | null>(null);
  const requestRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      api.tasks.onEvent((e: TaskEvent) => {
        if (e.requestId !== requestRef.current) return;
        if (e.type === "delta") setDraft((d) => (d && d.requestId === e.requestId ? { ...d, text: d.text + e.text } : d));
        else {
          requestRef.current = null;
          setDraft(null);
          if (e.type === "done") setMessages((m) => [...m, e.message]);
          else {
            if (e.partial) setMessages((m) => [...m, e.partial!]);
            if (e.code !== "aborted") setFailure({ code: e.code, message: e.message });
          }
        }
      }),
    []
  );

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, draft]);

  const run = useCallback(
    async (kind: TaskKind, sel: SelectionInfo | null, q?: string) => {
      setTab("chat");
      setFailure(null);
      if (requestRef.current) await api.tasks.cancel(requestRef.current);
      try {
        const started = await api.tasks.run({
          kind,
          selection: sel?.text ?? "",
          context: sel?.context,
          question: q,
          docId: docId ?? undefined,
          // Explain/note/diagram start a fresh thread; follow-up questions continue it.
          conversationId: kind === "ask" ? (conversationId ?? undefined) : undefined
        });
        requestRef.current = started.requestId;
        if (started.conversationId !== conversationId) {
          setConversationId(started.conversationId);
          setMessages([started.userMessage]);
        } else setMessages((m) => [...m, started.userMessage]);
        setDraft({ requestId: started.requestId, text: "" });
      } catch (err) {
        setFailure({ code: "invalid", message: (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") });
      }
    },
    [conversationId, docId]
  );

  useEffect(() => {
    if (!trigger) return;
    if (trigger.kind === "ask") {
      setTab("chat");
      setAttached(trigger.sel);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else void run(trigger.kind, trigger.sel);
    // Only react to new triggers.
  }, [trigger?.seq]);

  const submit = () => {
    const q = question.trim();
    if (!q || draft) return;
    setQuestion("");
    void run("ask", attached, q);
    setAttached(null);
  };

  const insertIntoNote = async (m: StoredMessage) => {
    const note = noteId
      ? await api.notes.append(noteId, m.content)
      : await api.notes.create({ title: docTitle ? `${docTitle} · 笔记` : "新笔记", body: m.content, sourceDocId: docId ?? undefined });
    setNoteId(note.id);
    setNotesVersion((v) => v + 1);
    setInsertedId(m.id);
  };

  const newConversation = () => {
    if (requestRef.current) void api.tasks.cancel(requestRef.current);
    requestRef.current = null;
    setDraft(null);
    setConversationId(null);
    setMessages([]);
    setFailure(null);
  };

  return (
    <aside className="ai-panel" aria-label="AI 面板">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")}>
          对话
        </button>
        <button role="tab" aria-selected={tab === "notes"} onClick={() => setTab("notes")}>
          笔记
        </button>
        {tab === "chat" && messages.length > 0 && (
          <button className="link push-right" onClick={newConversation}>
            新对话
          </button>
        )}
      </div>

      {tab === "notes" ? (
        hasWorkspace ? (
          <NotesPanel current={noteId} onSelect={setNoteId} version={notesVersion} docId={docId} docTitle={docTitle} />
        ) : (
          <div className="panel-body placeholder">先选择一个工作区</div>
        )
      ) : (
        <>
          <div className="chat-log" ref={logRef} data-testid="chat-log">
            {messages.length === 0 && !draft && <div className="placeholder">在阅读器里选中文字，用浮条让 AI 解读、记笔记或画图；也可以直接提问。</div>}
            {messages.map((m) => (
              <div key={m.id} className={`msg ${m.role}`} data-role={m.role}>
                <Markdown text={m.content} />
                {m.role === "assistant" && (
                  <div className="msg-actions">
                    <button className="link" onClick={() => void insertIntoNote(m)}>
                      {insertedId === m.id ? "已插入笔记" : "插入笔记"}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {draft && (
              <div className="msg assistant streaming" data-role="assistant-draft">
                {draft.text ? <Markdown text={draft.text} streaming /> : <span className="hint">思考中…</span>}
                <div className="msg-actions">
                  <button className="link" onClick={() => requestRef.current && void api.tasks.cancel(requestRef.current)}>
                    停止
                  </button>
                </div>
              </div>
            )}
            {failure && (
              <div className="msg error" role="alert">
                {failure.code === "auth" ? (
                  <>
                    还没有可用的 API Key（{failure.message}）。
                    <button className="link" onClick={onOpenSettings}>
                      去设置
                    </button>
                  </>
                ) : (
                  <>出错了：{failure.message}</>
                )}
              </div>
            )}
          </div>
          <div className="composer">
            {attached && (
              <div className="attached">
                <span title={attached.text}>引用：{attached.text.slice(0, 60)}</span>
                <button className="link" onClick={() => setAttached(null)} aria-label="移除引用">
                  ×
                </button>
              </div>
            )}
            <textarea
              ref={inputRef}
              rows={3}
              placeholder={hasWorkspace ? "问点什么…（Enter 发送，Shift+Enter 换行）" : "先选择一个工作区"}
              disabled={!hasWorkspace}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </div>
        </>
      )}
    </aside>
  );
}
