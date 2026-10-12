import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskKind } from "@point/core";
import type { MessageMeta, StoredMessage, TaskEvent, TaskRequest } from "../shared/ipc";
import { Markdown } from "./Markdown";
import { NotesPanel, type NoteFlash } from "./NotesPanel";
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

type Failure = { code: string; message: string; request: TaskRequest };

const REASONS: Record<string, string> = {
  auth: "没有可用的 API Key，或 Key 无效",
  rate_limit: "请求太频繁，被模型服务限流了",
  network: "网络连接失败",
  server: "模型服务暂时出错",
  bad_request: "请求被模型服务拒绝"
};

const stripIpcPrefix = (m: string) => m.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

function QuoteCard({ meta }: { meta: MessageMeta }) {
  const [open, setOpen] = useState(false);
  const { selection, page } = meta.request;
  if (!selection?.trim()) return null;
  const source = [meta.docTitle ? `《${meta.docTitle}》` : null, page ? `第 ${page} 页` : null].filter(Boolean).join(" · ");
  return (
    <blockquote className={`quote-card${open ? " open" : ""}`} data-testid="quote-card">
      <button className="quote-text" onClick={() => setOpen((o) => !o)} title={open ? "收起" : "展开"}>
        {selection.trim()}
      </button>
      {source && <div className="quote-source">{source}</div>}
    </blockquote>
  );
}

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
  const [flash, setFlash] = useState<NoteFlash | null>(null);
  const [notePending, setNotePending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const requestRef = useRef<{ id: string; req: TaskRequest } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const noteIdRef = useRef<string | null>(null);
  noteIdRef.current = noteId;

  const insertIntoNote = useCallback(
    async (text: string) => {
      const id = noteIdRef.current;
      const note = id
        ? await api.notes.append(id, text)
        : await api.notes.create({ title: docTitle ? `${docTitle} · 笔记` : "新笔记", body: text, sourceDocId: docId ?? undefined });
      setNoteId(note.id);
      setNotesVersion((v) => v + 1);
      setFlash({ noteId: note.id, text: text.trim(), seq: Date.now() });
      setTab("notes");
    },
    [docId, docTitle]
  );

  const handleRef = useRef<(e: TaskEvent) => void>(() => {});
  handleRef.current = (e: TaskEvent) => {
    const cur = requestRef.current;
    if (!cur || e.requestId !== cur.id) return;
    if (e.type === "delta") {
      setDraft((d) => (d && d.requestId === e.requestId ? { ...d, text: d.text + e.text } : d));
      return;
    }
    requestRef.current = null;
    setDraft(null);
    setNotePending(false);
    if (e.type === "done") {
      setMessages((m) => [...m, e.message]);
      // 记笔记: the generated note goes straight into the current note.
      if (cur.req.kind === "note") void insertIntoNote(e.message.content);
    } else {
      if (e.partial) setMessages((m) => [...m, e.partial!]);
      if (e.code !== "aborted") setFailure({ code: e.code, message: e.message, request: cur.req });
    }
  };
  // Events can arrive before tasks.run() resolves with the request id; keep them until then.
  const early = useRef<TaskEvent[]>([]);
  useEffect(
    () =>
      api.tasks.onEvent((e: TaskEvent) => {
        if (requestRef.current?.id === e.requestId) handleRef.current(e);
        else if (early.current.length < 2000) early.current.push(e);
      }),
    []
  );

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, draft, failure]);

  const start = useCallback(
    async (req: TaskRequest) => {
      setFailure(null);
      if (requestRef.current) await api.tasks.cancel(requestRef.current.id);
      try {
        const started = await api.tasks.run(req);
        requestRef.current = { id: started.requestId, req };
        const queued = early.current.filter((e) => e.requestId === started.requestId);
        early.current = [];
        if (req.regenerate) {
          // Server dropped the previous answer; mirror that locally.
          setMessages((m) => {
            const out = [...m];
            while (out.at(-1)?.role === "assistant") out.pop();
            return out;
          });
        } else if (started.conversationId !== conversationId) {
          setConversationId(started.conversationId);
          setMessages(started.userMessage ? [started.userMessage] : []);
        } else if (started.userMessage) setMessages((m) => [...m, started.userMessage!]);
        setDraft({ requestId: started.requestId, text: "" });
        if (req.kind === "note") setNotePending(true);
        for (const e of queued) handleRef.current(e);
      } catch (err) {
        setFailure({ code: "invalid", message: stripIpcPrefix((err as Error).message), request: req });
      }
    },
    [conversationId]
  );

  const run = useCallback(
    (kind: TaskKind, sel: SelectionInfo | null, q?: string) =>
      start({
        kind,
        selection: sel?.text ?? "",
        context: sel?.context,
        page: sel?.page,
        question: q,
        docId: docId ?? undefined,
        // Selection actions start a fresh thread; questions continue the current one.
        conversationId: kind === "ask" ? (conversationId ?? undefined) : undefined
      }),
    [start, docId, conversationId]
  );

  const regenerate = (req: TaskRequest) => start({ ...req, conversationId: conversationId ?? undefined, regenerate: !!conversationId });

  const lastRequest = (): TaskRequest | null => {
    const u = [...messages].reverse().find((m) => m.role === "user" && m.meta);
    return u?.meta ? { ...u.meta.request } : null;
  };

  useEffect(() => {
    if (!trigger) return;
    if (trigger.kind === "ask") {
      setTab("chat");
      setAttached(trigger.sel);
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    setTab(trigger.kind === "note" ? "notes" : "chat");
    void run(trigger.kind, trigger.sel);
    // Only react to new triggers.
  }, [trigger?.seq]);

  const send = () => {
    const q = question.trim();
    if (!q || draft) return;
    setQuestion("");
    void run("ask", attached, q);
    setAttached(null);
  };

  const stop = () => {
    if (requestRef.current) void api.tasks.cancel(requestRef.current.id);
  };

  const copy = async (m: StoredMessage) => {
    await navigator.clipboard.writeText(m.content);
    setCopiedId(m.id);
    setTimeout(() => setCopiedId((c) => (c === m.id ? null : c)), 1200);
  };

  const newConversation = () => {
    stop();
    requestRef.current = null;
    setDraft(null);
    setConversationId(null);
    setMessages([]);
    setFailure(null);
  };

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

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
          <NotesPanel current={noteId} onSelect={setNoteId} version={notesVersion} docId={docId} docTitle={docTitle} flash={flash} pending={notePending} />
        ) : (
          <div className="panel-body placeholder">先选择一个工作区</div>
        )
      ) : (
        <>
          <div className="chat-log" ref={logRef} data-testid="chat-log">
            {messages.length === 0 && !draft && !failure && (
              <div className="placeholder">在阅读器里选中文字，用浮条让 AI 解读、记笔记或画图；也可以直接提问。</div>
            )}
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="turn">
                  {m.meta && <QuoteCard meta={m.meta} />}
                  <div className="msg user" data-role="user">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="msg assistant" data-role="assistant">
                  <Markdown text={m.content} />
                  <div className="msg-actions">
                    <button className="link" onClick={() => void insertIntoNote(m.content)}>
                      插入笔记
                    </button>
                    <button className="link" onClick={() => void copy(m)}>
                      {copiedId === m.id ? "已复制" : "复制"}
                    </button>
                    {m.id === lastAssistantId && !draft && lastRequest() && (
                      <button className="link" onClick={() => void regenerate(lastRequest()!)}>
                        重新生成
                      </button>
                    )}
                  </div>
                </div>
              )
            )}
            {draft && (
              <div className="msg assistant streaming" data-role="assistant-draft" aria-busy="true">
                {draft.text ? <Markdown text={draft.text} streaming /> : null}
                <span className="caret" aria-hidden />
              </div>
            )}
            {failure && (
              <div className="msg assistant error" role="alert" data-testid="chat-error">
                <div className="error-reason">{REASONS[failure.code] ?? "出错了"}</div>
                <div className="error-detail">{failure.message}</div>
                <div className="error-actions">
                  {failure.code === "auth" && (
                    <button className="link" onClick={onOpenSettings}>
                      去设置
                    </button>
                  )}
                  {failure.code !== "invalid" && (
                    <button className="link" onClick={() => void regenerate(failure.request)}>
                      重试
                    </button>
                  )}
                </div>
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
                  send();
                }
              }}
            />
            <div className="composer-actions">
              {draft ? (
                <button onClick={stop}>停止</button>
              ) : (
                <button className="primary" onClick={send} disabled={!question.trim() || !hasWorkspace}>
                  发送
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
