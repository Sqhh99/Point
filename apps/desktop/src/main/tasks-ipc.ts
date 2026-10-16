import { ipcMain, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { TASK_LABELS, buildTaskMessages, describeTask, effortOf, modelSpec, parseTaskOutput, providerConfig, type BranchOrigin, type ChatMessage, type TaskKind } from "@point/core";
import { exportAllNotes, exportConversation, exportNote } from "./export.js";
import { IPC, type TaskEvent, type TaskRequest, type TaskStarted } from "../shared/ipc.js";
import {
  addMessage,
  addSibling,
  createBranch,
  getOrigin,
  createConversation,
  deleteConversation,
  getMessage,
  getMessages,
  getTree,
  hasConversation,
  historyFor,
  getConversationModel,
  listConversations,
  setConversationModel,
  threadOf
} from "./conversations.js";
import { view as settingsView } from "./settings.js";
import { fakeEnabled } from "./fake-llm.js";
import { errInfo, providerFor } from "./ipc.js";
import { docTitle, need } from "./workspace.js";
import { assertCaptureSha, captureImage } from "./capture.js";
import { assertVisionAllowed, withImage } from "./vision.js";
import { buildBatchMessage, loadBatch } from "./marks-ipc.js";

const KINDS = Object.keys(TASK_LABELS) as TaskKind[];
const running = new Map<string, AbortController>();

const str = (v: unknown, max: number): string | undefined => (typeof v === "string" ? v.slice(0, max) : undefined);

function validate(raw: unknown): TaskRequest {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!KINDS.includes(r.kind as TaskKind)) throw new Error("无效的任务类型");
  return {
    kind: r.kind as TaskKind,
    selection: str(r.selection, 50_000) ?? "",
    context: str(r.context, 20_000),
    question: str(r.question, 4_000),
    // "" is not a document: normalise to undefined so nothing downstream treats it as "no filter".
    docId: str(r.docId, 64) || undefined,
    page: typeof r.page === "number" && Number.isInteger(r.page) && r.page > 0 ? r.page : undefined,
    conversationId: str(r.conversationId, 64),
    marks: r.marks === undefined || r.marks === null ? undefined : (Array.isArray(r.marks) ? r.marks : []).map((v) => str(v, 64) ?? "").slice(0, 21),
    image: r.image === undefined || r.image === null ? undefined : assertCaptureSha(r.image),
    regenerate: r.regenerate === true,
    parentId: messageRef(r, "parentId", true),
    branch: branchOf(r.branch),
    siblingOf: messageRef(r, "siblingOf", false) ?? undefined,
    model: str(r.model, 128),
    effort: str(r.effort, 32)
  };
}

/**
 * Strict type check for a message-id field, done at the tasks:run entry before anything else:
 * absent (or undefined) → undefined; `null` → null only where allowed; otherwise it must be a
 * non-empty string of at most 64 chars. Numbers, "", objects… are rejected — never coerced.
 */
function messageRef(r: Record<string, unknown>, key: "parentId" | "siblingOf", allowNull: boolean): string | null | undefined {
  if (!(key in r) || r[key] === undefined) return undefined;
  const v = r[key];
  if (v === null && allowNull) return null;
  if (typeof v !== "string" || v.length === 0 || v.length > 64) throw new Error(`无效的 ${key}`);
  return v;
}

function branchOf(v: unknown): TaskRequest["branch"] {
  if (v === undefined || v === null) return undefined;
  const b = v as Record<string, unknown>;
  const int = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0;
  if (typeof b !== "object" || typeof b.sourceId !== "string" || !int(b.start) || !int(b.end) || typeof b.quote !== "string" || !b.quote || b.quote.length > 10_000) {
    throw new Error("无效的分支位置");
  }
  return { sourceId: b.sourceId.slice(0, 64), start: b.start as number, end: b.end as number, quote: b.quote };
}

/** Where a turn goes in the tree, checked against the conversation (never trusts renderer ids). */
function placement(
  conversationId: string | undefined,
  req: TaskRequest
): { history: ChatMessage[]; userParent?: string | null; answerTo?: string; siblingOf?: string; origin?: BranchOrigin } {
  if (req.siblingOf !== undefined && (req.parentId !== undefined || req.branch || req.regenerate)) {
    throw new Error("siblingOf 不能和 parentId / branch / regenerate 同时使用");
  }
  if (!conversationId) {
    if (typeof req.parentId === "string" || req.branch || req.siblingOf !== undefined) throw new Error("对话不存在");
    return { history: [] };
  }
  const inConv = (id: string) => {
    const m = getMessage(id);
    if (!m || m.conversationId !== conversationId) throw new Error("消息不在这个对话里");
    return m;
  };
  const upTo = (id: string | null) => (id ? historyFor(conversationId, false, id) : []);
  if (req.siblingOf !== undefined) {
    // 从这里分支 on a question: same parent as the original; a span-branch question keeps its origin.
    const orig = inConv(req.siblingOf);
    if (orig.role !== "user") throw new Error("只能改问用户的问题");
    const origin = getOrigin(orig.id);
    return { history: upTo(orig.parentId), userParent: orig.parentId, siblingOf: orig.id, origin };
  }
  if (req.branch) {
    if (inConv(req.branch.sourceId).role !== "assistant") throw new Error("分支只能从 AI 回答派生");
    return { history: upTo(req.branch.sourceId) };
  }
  if (req.regenerate) {
    // Answer this user message again; the old answer(s) stay as siblings.
    const user = req.parentId ? inConv(req.parentId) : [...threadOf(conversationId)].reverse().find((m) => m.role === "user");
    if (!user || user.role !== "user") throw new Error("找不到要重新回答的问题");
    return { history: upTo(user.parentId), answerTo: user.id };
  }
  if (req.parentId === null) return { history: [], userParent: null };
  if (req.parentId) return { history: upTo(inConv(req.parentId).id), userParent: req.parentId };
  return { history: historyFor(conversationId) };
}

function resolveAsk(req: TaskRequest, conversationId: string | undefined): {
  model: string;
  effort: string | null;
  effortWrites?: ReturnType<typeof effortOf> extends infer E ? E extends { writes: infer W } ? W : never : never;
  omitTemperature: boolean;
  notice?: string;
} {
  // Effort is validated against ModelSpec before any write and without decrypting the API key.
  // Fake LLM still resolves model/effort (and notice) so first-ask memory and UI match production.
  const active = settingsView();
  const remembered = conversationId ? getConversationModel(conversationId) : { model: null, effort: null };
  const wantModel = req.model ?? remembered.model ?? active.active.model;
  const p = providerConfig(active.activeProvider)!;
  let spec = modelSpec(active.activeProvider, wantModel);
  let notice: string | undefined;
  if (!spec) {
    spec = modelSpec(active.activeProvider, p.defaultModel)!;
    notice = `原模型已不可用，已改用 ${spec.label}`;
  }
  // Explicit effort that the model does not declare → hard reject (no silent ignore).
  if (req.effort !== undefined && req.effort !== null && req.effort !== "") {
    const level = effortOf(spec, req.effort);
    if (!level || level.id !== req.effort) throw new Error(`该模型不支持思考等级「${req.effort}」`);
    if (fakeEnabled()) return { model: spec.id, effort: level.id, omitTemperature: false, notice };
    return { model: spec.id, effort: level.id, effortWrites: level.writes, omitTemperature: level.thinking, notice };
  }
  const wantEffort = remembered.effort ?? spec.defaultEffort;
  if (wantEffort) {
    const level = effortOf(spec, wantEffort);
    if (level) {
      if (fakeEnabled()) return { model: spec.id, effort: level.id, omitTemperature: false, notice };
      return { model: spec.id, effort: level.id, effortWrites: level.writes, omitTemperature: level.thinking, notice };
    }
  }
  return { model: spec.id, effort: null, omitTemperature: false, notice };
}

async function stream(
  sender: WebContents,
  requestId: string,
  conversationId: string,
  req: TaskRequest,
  messages: ReturnType<typeof buildTaskMessages>,
  llm: ReturnType<typeof providerFor> | undefined,
  parentId: string,
  ask: ReturnType<typeof resolveAsk>
) {
  const ctrl = new AbortController();
  running.set(requestId, ctrl);
  const send = (e: TaskEvent) => {
    if (!sender.isDestroyed()) sender.send(IPC.tasksEvent, e);
  };
  let text = "";
  try {
    if (ask.notice) send({ requestId, type: "model-notice", message: ask.notice });
    const { provider } = llm ?? providerFor();
    for await (const d of provider.chat(messages, {
      model: ask.model,
      signal: ctrl.signal,
      effortWrites: ask.effortWrites,
      omitTemperature: ask.omitTemperature
    })) {
      text += d.text;
      send({ requestId, type: "delta", text: d.text });
    }
    const { markdown } = parseTaskOutput(req.kind, text);
    send({ requestId, type: "done", message: addMessage(conversationId, "assistant", markdown, req.kind, undefined, parentId) });
  } catch (err) {
    const partial = text.trim() ? addMessage(conversationId, "assistant", text.trim(), req.kind, undefined, parentId) : undefined;
    send({ requestId, type: "error", ...errInfo(err), partial });
  } finally {
    running.delete(requestId);
  }
}

export function registerTasksIpc(): void {
  ipcMain.handle(IPC.tasksRun, (e, raw: unknown): TaskStarted => {
    const ws = need();
    const req = validate(raw);
    // Gate before anything is stored: an image on a text-only model is a clear error, not a silent drop.
    // Without an image the provider is resolved lazily so a missing key still streams back as an "auth" event.
    if (req.marks && (req.kind !== "ask" || req.image)) throw new Error("一起问只能和问题一起发送");
    const batch = req.marks ? loadBatch(req.marks, req.docId) : undefined;
    const needsVision = !!req.image || !!batch?.hasImage;
    const llm = needsVision ? providerFor() : undefined;
    if (llm) assertVisionAllowed(llm.vision, true);
    const image = req.image ? captureImage(ws.root, req.image) : undefined;
    const title = req.docId ? docTitle(req.docId) : undefined;
    let conversationId = req.conversationId && hasConversation(req.conversationId) ? req.conversationId : undefined;
    const regenerate = !!(req.regenerate && conversationId);
    if (req.branch && (req.kind !== "ask" || regenerate)) throw new Error("追问分支只能和问题一起发送");
    // Resolve model/effort before any write: unsupported effort throws with nothing stored.
    const ask = resolveAsk(req, conversationId);
    const place = placement(conversationId, { ...req, regenerate });
    const history = place.history;
    // Build first so invalid input (empty selection, missing question) fails before anything is stored.
    let messages = withImage(
      buildTaskMessages({ kind: req.kind, selection: req.selection, context: req.context, question: req.question, docTitle: title, history, hasImage: !!image }),
      image
    );
    // 「一起问」: the question turn becomes ONE user message whose parts follow the marks' selection order.
    if (batch) messages = [...messages.slice(0, -1), buildBatchMessage(req.question ?? "", batch.loaded, title)];
    if (!conversationId) {
      const sel = req.selection.trim().replace(/\s+/g, " ");
      conversationId = createConversation(`${TASK_LABELS[req.kind]}：${sel.slice(0, 30) || req.question?.slice(0, 30) || (image ? "截图" : "")}`, req.docId).id;
      // First ask: remember the same model/effort the run just resolved (ModelBar had nowhere to write yet).
      setConversationModel(conversationId, ask.model, ask.effort);
    }
    const meta = { request: { kind: req.kind, selection: req.selection, context: req.context, question: req.question, docId: req.docId, page: req.page, image: req.image, marks: batch?.marks.map((m) => m.id) }, docTitle: title, marks: batch?.marks.map((m) => m.anchor) };
    const userMessage = place.answerTo
      ? undefined
      : req.branch
        ? createBranch(req.branch.sourceId, req.branch, describeTask(req), req.kind, meta)
        : place.siblingOf
          ? addSibling(place.siblingOf, describeTask(req), req.kind, meta)
          : addMessage(conversationId, "user", describeTask(req), req.kind, meta, place.userParent);
    const requestId = randomUUID();
    void stream(e.sender, requestId, conversationId, req, messages, llm, place.answerTo ?? userMessage!.id, ask);
    return { requestId, conversationId, userMessage };
  });
  ipcMain.handle(IPC.tasksCancel, (_e, id: unknown) => {
    if (typeof id === "string") running.get(id)?.abort();
  });

  ipcMain.handle(IPC.convList, () => listConversations());
  ipcMain.handle(IPC.convMessages, (_e, id: unknown) => (typeof id === "string" ? getMessages(id) : []));
  ipcMain.handle(IPC.convTree, (_e, id: unknown) => (typeof id === "string" ? getTree(id) : { messages: [], origins: [] }));
  ipcMain.handle(IPC.conversationModel, (_e, id: unknown, model: unknown, effort: unknown) => {
    if (typeof id !== "string") throw new Error("无效的对话 id");
    if (!(model === null || typeof model === "string")) throw new Error("无效的模型");
    if (!(effort === null || typeof effort === "string")) throw new Error("无效的思考等级");
    setConversationModel(id, model, effort);
  });
  ipcMain.handle(IPC.convRemove, (_e, id: unknown) => {
    if (typeof id === "string") deleteConversation(id);
  });

  const notes = () => need().notes;
  const id = (v: unknown) => {
    if (typeof v !== "string") throw new Error("无效的笔记 id");
    return v;
  };
  ipcMain.handle(IPC.notesList, () => notes().list());
  ipcMain.handle(IPC.notesRead, (_e, v: unknown) => notes().read(id(v)));
  ipcMain.handle(IPC.notesCreate, (_e, input: unknown) => {
    const i = (input ?? {}) as Record<string, unknown>;
    return notes().create({
      title: str(i.title, 200) ?? "",
      body: str(i.body, 1_000_000),
      sourceDocId: str(i.sourceDocId, 64),
      tags: Array.isArray(i.tags) ? i.tags.filter((t): t is string => typeof t === "string").slice(0, 32) : undefined
    });
  });
  ipcMain.handle(IPC.notesUpdate, (_e, v: unknown, patch: unknown) => {
    const p = (patch ?? {}) as Record<string, unknown>;
    return notes().update(id(v), {
      title: str(p.title, 200),
      body: str(p.body, 1_000_000),
      tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === "string").slice(0, 32) : undefined
    });
  });
  ipcMain.handle(IPC.notesAppend, (_e, v: unknown, text: unknown) => notes().append(id(v), str(text, 1_000_000) ?? ""));
  ipcMain.handle(IPC.notesExportCurrent, (e, v: unknown) => exportNote(e.sender, id(v)));
  ipcMain.handle(IPC.notesExportAll, (e) => exportAllNotes(e.sender));
  ipcMain.handle(IPC.convExport, (e, v: unknown) => {
    if (typeof v !== "string") throw new Error("无效的对话 id");
    return exportConversation(e.sender, v);
  });
}
