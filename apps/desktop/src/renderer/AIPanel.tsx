import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Mark, MarkAnchor, TaskKind } from "@point/core";
// Pure tree helpers only: the core barrel also pulls in Node modules that cannot load in the renderer.
import { branchTree, branchesFrom, breadcrumb, defaultLeaf, latestLeaf, pathTo, siblingsOf, type BranchOrigin, type BranchTreeNode } from "@point/core/tree";
import type { CaptureResult, MessageMeta, StoredMessage, TaskEvent, TaskRequest } from "../shared/ipc";
import { Markdown } from "./Markdown";
import { NotesPanel, type NoteFlash } from "./NotesPanel";
import type { SelectionInfo } from "./Reader";

const api = window.point;

export interface TaskTrigger {
  seq: number;
  kind: TaskKind;
  sel: SelectionInfo;
  /** Region capture sha (解读 on a region). */
  image?: string;
}

/** 「一起问」 from the marks list: the picked marks, in the order they were checked. */
export interface BatchTrigger {
  seq: number;
  marks: Mark[];
}

interface Props {
  trigger: TaskTrigger | null;
  docId: string | null;
  docTitle: string | null;
  hasWorkspace: boolean;
  /** Current model accepts images. */
  vision: boolean;
  /** Latest region capture; a new seq attaches it to the composer. */
  capture: (CaptureResult & { seq: number }) | null;
  batch: BatchTrigger | null;
  onOpenSettings(): void;
}

type Failure = { code: string; message: string; request: TaskRequest };

const REASONS: Record<string, string> = {
  auth: "没有可用的 API Key，或 Key 无效",
  rate_limit: "请求太频繁，被模型服务限流了",
  network: "网络连接失败",
  server: "模型服务暂时出错",
  bad_request: "请求被模型服务拒绝",
  no_vision: "当前模型不支持图片"
};

export const NO_VISION_TEXT = "当前模型不支持图片。请在「设置」里换一个支持看图的模型（例如 gpt-4o、glm-4v-flash），或勾选「该模型支持看图」。";

const stripIpcPrefix = (m: string) => m.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

export const captureUrl = (sha: string) => `point-capture://${sha}`;

/** A capture image; a 404 (deleted file, other workspace) becomes a same-size 「截图已失效」 box. */
function CaptureImg({ sha, alt, onBroken }: { sha: string; alt: string; onBroken?(): void }) {
  const [broken, setBroken] = useState(false);
  if (broken)
    return (
      <span className="capture-missing" data-testid="capture-missing" role="img" aria-label="截图已失效">
        截图已失效
      </span>
    );
  return (
    <img
      src={captureUrl(sha)}
      alt={alt}
      onError={() => {
        setBroken(true);
        onBroken?.();
      }}
    />
  );
}

function BubbleImage({ sha, onOpen }: { sha: string; onOpen(sha: string): void }) {
  const [broken, setBroken] = useState(false);
  if (broken)
    return (
      <div className="quote-image missing" data-testid="bubble-image">
        <CaptureImg sha={sha} alt="截图" />
      </div>
    );
  return (
    <button className="quote-image" data-testid="bubble-image" onClick={() => onOpen(sha)} title="查看大图">
      <CaptureImg sha={sha} alt="截图" onBroken={() => setBroken(true)} />
    </button>
  );
}

/** Full-size view of a screenshot; Esc or any click closes it. */
function Lightbox({ sha, onClose }: { sha: string; onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lightbox" data-testid="lightbox" role="dialog" aria-label="截图大图" onClick={onClose}>
      <img src={captureUrl(sha)} alt="截图" />
    </div>
  );
}

function TreeList({ nodes, current, onPick }: { nodes: BranchTreeNode[]; current?: string; onPick(id: string): void }) {
  if (nodes.length === 0) return null;
  return (
    <ul>
      {nodes.map((n) => (
        <li key={n.branchId}>
          <button className={n.branchId === current ? "current" : ""} onClick={() => onPick(n.branchId)}>
            「{n.quote.slice(0, 24)}」
          </button>
          <TreeList nodes={n.children} current={current} onPick={onPick} />
        </li>
      ))}
    </ul>
  );
}

function MarksCard({ marks, docTitle, onOpenImage }: { marks: MarkAnchor[]; docTitle?: string; onOpenImage(sha: string): void }) {
  return (
    <blockquote className="quote-card" data-testid="quote-card">
      <ol className="quote-marks">
        {marks.map((a, i) => (
          <li key={i}>{a.kind === "text" ? <span className="quote-mark-text">{a.text}</span> : <BubbleImage sha={a.sha} onOpen={onOpenImage} />}</li>
        ))}
      </ol>
      {docTitle && <div className="quote-source">《{docTitle}》</div>}
    </blockquote>
  );
}

function QuoteCard({ meta, onOpenImage }: { meta: MessageMeta; onOpenImage(sha: string): void }) {
  const [open, setOpen] = useState(false);
  const { selection, page, image } = meta.request;
  if (meta.marks?.length) return <MarksCard marks={meta.marks} docTitle={meta.docTitle} onOpenImage={onOpenImage} />;
  if (!selection?.trim() && !image) return null;
  const source = [meta.docTitle ? `《${meta.docTitle}》` : null, page ? `第 ${page} 页` : null].filter(Boolean).join(" · ");
  return (
    <blockquote className={`quote-card${open ? " open" : ""}`} data-testid="quote-card">
      {image && (
        <BubbleImage sha={image} onOpen={onOpenImage} />
      )}
      {selection?.trim() && (
        <button className="quote-text" onClick={() => setOpen((o) => !o)} title={open ? "收起" : "展开"}>
          {selection.trim()}
        </button>
      )}
      {source && <div className="quote-source">{source}</div>}
    </blockquote>
  );
}

export function AIPanel({ trigger, docId, docTitle, hasWorkspace, vision, capture, batch, onOpenSettings }: Props) {
  const [batchMarks, setBatchMarks] = useState<Mark[] | null>(null);
  const [image, setImage] = useState<CaptureResult | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const closeViewer = useCallback(() => setViewing(null), []);
  const [tab, setTab] = useState<"chat" | "notes">("chat");
  const [conversationId, setConversationId] = useState<string | null>(null);
  // The whole conversation tree; what is shown is the root → leaf path.
  const [tree, setTree] = useState<{ messages: StoredMessage[]; origins: BranchOrigin[] }>({ messages: [], origins: [] });
  const [leafId, setLeafId] = useState<string | null>(null);
  const messages = useMemo(() => (leafId ? pathTo(tree.messages, leafId) : []), [tree, leafId]);
  /** Next send goes under this message (从这里分支); `null` = new first question. */
  const [fork, setFork] = useState<({ parentId: string } | { siblingOf: string }) & { label: string } | null>(null);
  const [branchDraft, setBranchDraft] = useState<NonNullable<TaskRequest["branch"]> | null>(null);
  /** First message re-mounted by a sibling switch, to fade it in. */
  const [switched, setSwitched] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [chipOpen, setChipOpen] = useState<string | null>(null);
  const [answerBar, setAnswerBar] = useState<{ top: number; left: number; branch: NonNullable<TaskRequest["branch"]> } | null>(null);

  const refresh = useCallback(async (convId: string, leaf?: string | null) => {
    const t = await api.conversations.tree(convId);
    setTree(t);
    setLeafId(leaf ?? defaultLeaf(t.messages, t.origins)?.id ?? null);
  }, []);
  const [draft, setDraft] = useState<{ requestId: string; text: string } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [attached, setAttached] = useState<SelectionInfo | null>(null);
  const [question, setQuestion] = useState("");
  const [noteId, setNoteId] = useState<string | null>(null);
  const [notesVersion, setNotesVersion] = useState(0);
  const [flash, setFlash] = useState<NoteFlash | null>(null);
  const [notePending, setNotePending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
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
    const convId = e.type === "done" ? e.message.conversationId : e.partial?.conversationId;
    if (e.type === "done") {
      void refresh(convId!, e.message.id);
      // 记笔记: the generated note goes straight into the current note.
      if (cur.req.kind === "note") void insertIntoNote(e.message.content);
    } else {
      if (e.partial) void refresh(convId!, e.partial.id);
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
        if (started.conversationId !== conversationId) setConversationId(started.conversationId);
        // Show the thread down to the question being answered; the old answer (if any) stays as a sibling.
        await refresh(started.conversationId, started.userMessage?.id ?? (req.regenerate ? (req.parentId ?? undefined) : undefined));
        setDraft({ requestId: started.requestId, text: "" });
        if (req.kind === "note") setNotePending(true);
        for (const e of queued) handleRef.current(e);
      } catch (err) {
        const message = stripIpcPrefix((err as Error).message);
        setFailure({ code: message.startsWith("当前模型不支持图片") ? "no_vision" : "invalid", message, request: req });
      }
    },
    [conversationId, refresh]
  );

  const run = useCallback(
    (kind: TaskKind, sel: SelectionInfo | null, q?: string, img?: string, markIds?: string[]) =>
      start({
        image: img,
        marks: markIds,
        kind,
        selection: sel?.text ?? "",
        context: sel?.context,
        page: sel?.page,
        question: q,
        docId: docId ?? undefined,
        // Selection actions start a fresh thread; questions continue the thread being shown.
        conversationId: kind === "ask" ? (conversationId ?? undefined) : undefined,
        parentId: kind === "ask" && conversationId ? (leafId ?? undefined) : undefined
      }),
    [start, docId, conversationId, leafId]
  );

  /** 重新生成 / 重试: answer `user` again as a new sibling answer. */
  const regenerate = (req: TaskRequest, user?: StoredMessage) =>
    start({ ...req, conversationId: conversationId ?? undefined, regenerate: !!conversationId, parentId: user?.id });
  const userBefore = (id: string): StoredMessage | undefined => {
    const i = messages.findIndex((m) => m.id === id);
    return [...messages.slice(0, i)].reverse().find((m) => m.role === "user");
  };
  const lastUser = () => [...messages].reverse().find((m) => m.role === "user");

  const switchTo = (id: string) => {
    setSwitched(id);
    setLeafId(latestLeaf(tree.messages, tree.origins, id)?.id ?? id);
  };
  const stepSibling = (id: string, delta: number) => {
    const sibs = siblingsOf(tree.messages, tree.origins, id);
    const next = sibs[sibs.findIndex((m) => m.id === id) + delta];
    if (next) switchTo(next.id);
  };
  // ⌥←/⌥→ (Alt on Windows) switches the last shown message that has alternatives.
  useEffect(() => {
    if (tab !== "chat") return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight") || draft) return;
      const m = [...messages].reverse().find((x) => siblingsOf(tree.messages, tree.origins, x.id).length > 1);
      if (!m) return;
      e.preventDefault();
      stepSibling(m.id, e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** 从这里分支: on an answer, continue under it; on a question, ask again in its place. */
  const forkFrom = (m: StoredMessage) => {
    setBranchDraft(null);
    if (m.role === "assistant") {
      setFork({ parentId: m.id, label: "从这条回答继续一个新分支" });
      setLeafId(m.id);
    } else {
      // Main decides the parent (and keeps a span-branch origin); the renderer never computes it.
      setFork({ siblingOf: m.id, label: "改问这个问题（新分支）" });
      setQuestion(m.content);
      setLeafId(m.parentId);
    }
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  /** Selecting text inside an answer offers 追问分支 (design v0.2). */
  const onLogMouseUp = () => {
    const s = window.getSelection();
    const log = logRef.current;
    if (!s || s.isCollapsed || !log || draft) return setAnswerBar(null);
    const range = s.getRangeAt(0);
    const el = (range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest<HTMLElement>(".msg.assistant[data-id]");
    const quote = s.toString().trim();
    const src = el && messages.find((m) => m.id === el.dataset.id);
    if (!src || quote.length < 2) return setAnswerBar(null);
    // Offsets are in the stored markdown: take the occurrence of the quote (rendered text may differ from source).
    const start = src.content.indexOf(quote);
    if (start < 0) return setAnswerBar(null);
    const r = range.getBoundingClientRect();
    const box = log.getBoundingClientRect();
    setAnswerBar({
      top: Math.max(r.top - box.top + log.scrollTop - 8 - 32, log.scrollTop),
      left: Math.min(Math.max(r.left - box.left + r.width / 2, 60), box.width - 60),
      branch: { sourceId: src.id, start, end: start + quote.length, quote }
    });
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
    void run(trigger.kind, trigger.sel, undefined, trigger.image);
    // Only react to new triggers.
  }, [trigger?.seq]);

  useEffect(() => {
    if (!capture) return;
    setTab("chat");
    setImage(capture);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [capture?.seq]);

  useEffect(() => {
    if (!batch) return;
    setTab("chat");
    setBatchMarks(batch.marks);
    setAttached(null);
    setImage(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [batch?.seq]);

  const send = () => {
    const q = question.trim();
    if (!q || draft) return;
    if (branchDraft || fork) {
      const req: TaskRequest = {
        kind: "ask",
        selection: branchDraft?.quote ?? "",
        question: q,
        docId: docId ?? undefined,
        conversationId: conversationId ?? undefined,
        ...(branchDraft ? { branch: branchDraft } : "siblingOf" in fork! ? { siblingOf: fork!.siblingOf } : { parentId: fork!.parentId })
      };
      setQuestion("");
      setBranchDraft(null);
      setFork(null);
      void start(req);
      return;
    }
    if (batchMarks) {
      const ids = batchMarks.map((m) => m.id);
      const req: TaskRequest = { kind: "ask", selection: "", question: q, marks: ids };
      if (batchMarks.some((m) => m.anchor.kind === "region") && !vision) return setFailure({ code: "no_vision", message: NO_VISION_TEXT, request: req });
      setQuestion("");
      void run("ask", null, q, undefined, ids);
      setBatchMarks(null);
      return;
    }
    const req: TaskRequest = { kind: "ask", selection: attached?.text ?? "", question: q, image: image?.sha };
    // Checked again in main; this keeps the question and the image so the user can switch models.
    if (image && !vision) return setFailure({ code: "no_vision", message: NO_VISION_TEXT, request: req });
    setQuestion("");
    void run("ask", attached, q, image?.sha);
    setAttached(null);
    setImage(null);
  };

  const stop = () => {
    if (requestRef.current) void api.tasks.cancel(requestRef.current.id);
  };

  const copy = async (m: StoredMessage) => {
    await navigator.clipboard.writeText(m.content);
    setCopiedId(m.id);
    setTimeout(() => setCopiedId((c) => (c === m.id ? null : c)), 1200);
  };

  const exportConversation = async () => {
    if (!conversationId) return;
    setExportStatus(null);
    const r = await api.conversations.export(conversationId);
    if (r.ok) {
      setExportStatus("已导出");
      setTimeout(() => setExportStatus(null), 2000);
    } else if (!("canceled" in r && r.canceled)) {
      setExportStatus("message" in r ? r.message : "导出失败");
    }
  };

  const newConversation = () => {
    stop();
    requestRef.current = null;
    setDraft(null);
    setConversationId(null);
    setTree({ messages: [], origins: [] });
    setLeafId(null);
    setFork(null);
    setBranchDraft(null);
    setFailure(null);
  };

  const crumbs = leafId ? breadcrumb(tree.messages, tree.origins, leafId) : [];
  /** Main thread as shown by default: newest first question, newest answers, no span branches. */
  const mainThreadLeaf = () => defaultLeaf(tree.messages, tree.origins)?.id ?? null;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  return (
    <aside className="ai-panel" aria-label="AI 面板">
      {viewing && <Lightbox sha={viewing} onClose={closeViewer} />}
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
          {leafId && (tree.origins.length > 0 || crumbs.length > 1) && (
            <nav className="crumbs" aria-label="分支路径" data-testid="crumbs">
              {crumbs.map((c, i) => (
                <span key={c.branchId ?? "main"} className="crumb">
                  {i > 0 && <span className="crumb-sep">›</span>}
                  <button
                    className={i === crumbs.length - 1 ? "link active" : "link"}
                    onClick={() => (c.branchId ? switchTo(c.branchId) : setLeafId(mainThreadLeaf()))}
                  >
                    {c.branchId ? `「${(c.quote ?? "").slice(0, 16)}」` : "主线"}
                  </button>
                </span>
              ))}
              {tree.origins.length > 0 && (
                <button className="link push-right" onClick={() => setTreeOpen((o) => !o)} aria-expanded={treeOpen}>
                  分支树
                </button>
              )}
              {treeOpen && (
                <div className="branch-tree" role="dialog" aria-label="分支树">
                  <ul>
                    <li>
                      <button className={crumbs.length === 1 ? "current" : ""} onClick={() => (setTreeOpen(false), setLeafId(mainThreadLeaf()))}>
                        主线
                      </button>
                      <TreeList nodes={branchTree(tree.messages, tree.origins)} current={crumbs.at(-1)?.branchId} onPick={(id) => (setTreeOpen(false), switchTo(id))} />
                    </li>
                  </ul>
                </div>
              )}
            </nav>
          )}
          <div className="chat-log" ref={logRef} data-testid="chat-log">
            {messages.length === 0 && !draft && !failure && (
              <div className="placeholder">在阅读器里选中文字，用浮条让 AI 解读、记笔记或画图；也可以直接提问。</div>
            )}
            {answerBar && (
              <div className="selection-toolbar answer-bar" role="toolbar" aria-label="回答选区操作" style={{ top: answerBar.top, left: answerBar.left }} onMouseDown={(e) => e.preventDefault()}>
                <button
                  onClick={() => {
                    setBranchDraft(answerBar.branch);
                    setFork(null);
                    setAnswerBar(null);
                    window.getSelection()?.removeAllRanges();
                    setTimeout(() => inputRef.current?.focus(), 0);
                  }}
                >
                  <span>追问分支</span>
                </button>
              </div>
            )}
            {messages.map((m, i) => {
              const sibs = siblingsOf(tree.messages, tree.origins, m.id);
              const at = sibs.findIndex((x) => x.id === m.id);
              const fade = switched && messages.findIndex((x) => x.id === switched) <= i ? " fade-in" : "";
              const switcher =
                sibs.length > 1 ? (
                  <div className="sibling-switch" data-testid="sibling-switch">
                    <button className="icon" aria-label="上一条" disabled={at <= 0} onClick={() => stepSibling(m.id, -1)}>
                      ‹
                    </button>
                    <span>
                      {at + 1}/{sibs.length}
                    </span>
                    <button className="icon" aria-label="下一条" disabled={at >= sibs.length - 1} onClick={() => stepSibling(m.id, 1)}>
                      ›
                    </button>
                  </div>
                ) : null;
              const forkBtn = (
                <button className="link" onClick={() => forkFrom(m)} disabled={!!draft}>
                  从这里分支
                </button>
              );
              if (m.role === "user")
                return (
                  <div key={m.id} className={"turn" + fade}>
                    {m.meta && <QuoteCard meta={m.meta} onOpenImage={setViewing} />}
                    <div className="msg user" data-role="user" data-id={m.id}>
                      {m.content}
                    </div>
                    <div className="user-foot">
                      {switcher}
                      <div className="msg-actions">{forkBtn}</div>
                    </div>
                  </div>
                );
              const branches = branchesFrom(tree.origins, m.id);
              const asked = userBefore(m.id);
              return (
                <div key={m.id} className={"msg assistant" + fade} data-role="assistant" data-id={m.id} onMouseUp={onLogMouseUp}>
                  <Markdown text={m.content} />
                  {branches.length > 0 && (
                    <div className="branch-chip-wrap">
                      <button className="branch-chip" data-testid="branch-chip" onClick={() => setChipOpen(chipOpen === m.id ? null : m.id)} aria-expanded={chipOpen === m.id}>
                        ⑂ {branches.length} 个分支
                      </button>
                      {chipOpen === m.id && (
                        <ul className="branch-menu" role="menu">
                          {branches.map((g) => (
                            <li key={g.origins[0].childId}>
                              <button
                                role="menuitem"
                                onClick={() => {
                                  setChipOpen(null);
                                  // One entry per span; enter its newest ask (the switcher shows the others).
                                  switchTo(g.origins.at(-1)!.childId);
                                }}
                              >
                                「{g.quote.slice(0, 40)}」
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <div className="assistant-foot">
                    {switcher}
                    <div className="msg-actions">
                      <button className="link" onClick={() => void insertIntoNote(m.content)}>
                        插入笔记
                      </button>
                      <button className="link" onClick={() => void copy(m)}>
                        {copiedId === m.id ? "已复制" : "复制"}
                      </button>
                      {!draft && asked?.meta && (
                        <button className="link" onClick={() => void regenerate({ ...asked.meta!.request }, asked)}>
                          重新生成
                        </button>
                      )}
                      {forkBtn}
                      {m.id === lastAssistantId && conversationId && (
                        <button className="link" onClick={() => void exportConversation()}>
                          {exportStatus === "已导出" ? "已导出" : "导出对话为 md"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
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
                  {(failure.code === "auth" || failure.code === "no_vision") && (
                    <button className="link" onClick={onOpenSettings}>
                      去设置
                    </button>
                  )}
                  {failure.code !== "invalid" && failure.code !== "no_vision" && (
                    <button
                      className="link"
                      onClick={() => void (failure.code === "invalid" || failure.code === "no_vision" ? start(failure.request) : regenerate(failure.request, lastUser()))}
                    >
                      重试
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="composer">
            {branchDraft && (
              <div className="attached" data-testid="branch-draft">
                <span title={branchDraft.quote}>追问分支：「{branchDraft.quote.slice(0, 40)}」</span>
                <button className="link" onClick={() => setBranchDraft(null)} aria-label="取消分支">
                  ×
                </button>
              </div>
            )}
            {fork && (
              <div className="attached" data-testid="fork-draft">
                <span>{fork.label}</span>
                <button className="link" onClick={() => (setFork(null), setLeafId(defaultLeaf(tree.messages, tree.origins)?.id ?? null))} aria-label="取消分支">
                  ×
                </button>
              </div>
            )}
            {batchMarks && (
              <div className="attached" data-testid="attached-marks">
                <span>一起问 {batchMarks.length} 个标记</span>
                <button className="link" onClick={() => setBatchMarks(null)} aria-label="移除标记">
                  ×
                </button>
              </div>
            )}
            {attached && (
              <div className="attached">
                <span title={attached.text}>引用：{attached.text.slice(0, 60)}</span>
                <button className="link" onClick={() => setAttached(null)} aria-label="移除引用">
                  ×
                </button>
              </div>
            )}
            {image && (
              <div className="attached-thumb" data-testid="attached-image">
                <CaptureImg key={image.sha} sha={image.sha} alt={`截图 ${image.width}×${image.height}`} />
                <button className="thumb-remove" onClick={() => setImage(null)} aria-label="移除截图">
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
