import { ipcMain, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { TASK_LABELS, buildTaskMessages, describeTask, parseTaskOutput, type TaskKind } from "@point/core";
import { IPC, type TaskEvent, type TaskRequest, type TaskStarted } from "../shared/ipc.js";
import { addMessage, createConversation, dropTrailingAssistant, deleteConversation, getMessages, hasConversation, historyFor, listConversations } from "./conversations.js";
import { errInfo, providerFor } from "./ipc.js";
import { docTitle, need } from "./workspace.js";

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
    docId: str(r.docId, 64),
    page: typeof r.page === "number" && Number.isInteger(r.page) && r.page > 0 ? r.page : undefined,
    conversationId: str(r.conversationId, 64),
    regenerate: r.regenerate === true
  };
}

async function stream(sender: WebContents, requestId: string, conversationId: string, req: TaskRequest, messages: ReturnType<typeof buildTaskMessages>) {
  const ctrl = new AbortController();
  running.set(requestId, ctrl);
  const send = (e: TaskEvent) => {
    if (!sender.isDestroyed()) sender.send(IPC.tasksEvent, e);
  };
  let text = "";
  try {
    const { provider, model } = providerFor();
    for await (const d of provider.chat(messages, { model, signal: ctrl.signal })) {
      text += d.text;
      send({ requestId, type: "delta", text: d.text });
    }
    const { markdown } = parseTaskOutput(req.kind, text);
    send({ requestId, type: "done", message: addMessage(conversationId, "assistant", markdown, req.kind) });
  } catch (err) {
    const partial = text.trim() ? addMessage(conversationId, "assistant", text.trim(), req.kind) : undefined;
    send({ requestId, type: "error", ...errInfo(err), partial });
  } finally {
    running.delete(requestId);
  }
}

export function registerTasksIpc(): void {
  ipcMain.handle(IPC.tasksRun, (e, raw: unknown): TaskStarted => {
    need();
    const req = validate(raw);
    const title = req.docId ? docTitle(req.docId) : undefined;
    let conversationId = req.conversationId && hasConversation(req.conversationId) ? req.conversationId : undefined;
    const regenerate = !!(req.regenerate && conversationId);
    const history = conversationId ? historyFor(conversationId, regenerate) : [];
    // Build first so invalid input (empty selection, missing question) fails before anything is stored.
    const messages = buildTaskMessages({ kind: req.kind, selection: req.selection, context: req.context, question: req.question, docTitle: title, history });
    if (!conversationId) {
      const sel = req.selection.trim().replace(/\s+/g, " ");
      conversationId = createConversation(`${TASK_LABELS[req.kind]}：${sel.slice(0, 30) || req.question?.slice(0, 30) || ""}`, req.docId).id;
    }
    const meta = { request: { kind: req.kind, selection: req.selection, context: req.context, question: req.question, docId: req.docId, page: req.page }, docTitle: title };
    if (regenerate) dropTrailingAssistant(conversationId);
    const userMessage = regenerate ? undefined : addMessage(conversationId, "user", describeTask(req), req.kind, meta);
    const requestId = randomUUID();
    void stream(e.sender, requestId, conversationId, req, messages);
    return { requestId, conversationId, userMessage };
  });
  ipcMain.handle(IPC.tasksCancel, (_e, id: unknown) => {
    if (typeof id === "string") running.get(id)?.abort();
  });

  ipcMain.handle(IPC.convList, () => listConversations());
  ipcMain.handle(IPC.convMessages, (_e, id: unknown) => (typeof id === "string" ? getMessages(id) : []));
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
}
