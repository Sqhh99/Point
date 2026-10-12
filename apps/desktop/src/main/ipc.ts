import { ipcMain, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { LLMError, createProvider, getPreset, type ChatMessage, type LLMProvider, type ProviderId } from "@point/core";
import { IPC, type ChatEvent, type ProviderPatch, type TestResult } from "../shared/ipc.js";
import { FakeProvider, fakeEnabled, fakeVision } from "./fake-llm.js";
import { resolveProvider, setKey, update, view } from "./settings.js";

const running = new Map<string, AbortController>();

function assertProviderId(id: unknown): asserts id is ProviderId {
  if (typeof id !== "string" || !getPreset(id)) throw new Error("无效的模型服务");
}

export function errInfo(err: unknown): { code: string; message: string } {
  if (err instanceof LLMError) return { code: err.code, message: err.message };
  const e = err as { code?: unknown; message?: string };
  return { code: typeof e.code === "string" ? e.code : "unknown", message: e.message ?? String(err) };
}

export function providerFor(id?: ProviderId): { model: string; vision: boolean; provider: LLMProvider } {
  if (fakeEnabled()) return { model: "fake", vision: fakeVision(), provider: new FakeProvider() };
  const cfg = resolveProvider(id);
  return { model: cfg.model, vision: cfg.vision, provider: createProvider({ id: cfg.id, apiKey: cfg.apiKey, baseURL: cfg.baseURL }) };
}

async function runChat(sender: WebContents, requestId: string, messages: ChatMessage[], id?: ProviderId): Promise<void> {
  const ctrl = new AbortController();
  running.set(requestId, ctrl);
  const send = (e: ChatEvent) => {
    if (!sender.isDestroyed()) sender.send(IPC.chatEvent, e);
  };
  try {
    const { provider, model } = providerFor(id);
    for await (const d of provider.chat(messages, { model, signal: ctrl.signal })) {
      send({ requestId, type: "delta", text: d.text });
    }
    send({ requestId, type: "done" });
  } catch (err) {
    send({ requestId, type: "error", ...errInfo(err) });
  } finally {
    running.delete(requestId);
  }
}

export function registerIpc(): void {
  ipcMain.handle(IPC.settingsGet, () => view());
  ipcMain.handle(IPC.settingsUpdate, (_e, patch: ProviderPatch) => {
    assertProviderId(patch?.id);
    return update(patch);
  });
  ipcMain.handle(IPC.settingsSetKey, (_e, id: unknown, key: unknown) => {
    assertProviderId(id);
    if (typeof key !== "string") throw new Error("无效的 API Key");
    return setKey(id, key);
  });
  ipcMain.handle(IPC.settingsTest, async (_e, id: unknown): Promise<TestResult> => {
    assertProviderId(id);
    try {
      const { provider, model } = providerFor(id);
      let sample = "";
      const opts = { model, maxTokens: 8, signal: AbortSignal.timeout(20_000) };
      for await (const d of provider.chat([{ role: "user", content: "ping" }], opts)) sample += d.text;
      return { ok: true, sample };
    } catch (err) {
      return { ok: false, ...errInfo(err) };
    }
  });
  ipcMain.handle(IPC.chatStart, (e, messages: unknown, id?: unknown) => {
    if (id !== undefined) assertProviderId(id);
    if (!Array.isArray(messages)) throw new Error("无效的消息");
    const requestId = randomUUID();
    // Rebuild each message: only role + text cross IPC; images are attached in main from a capture sha.
    const clean: ChatMessage[] = (messages as Partial<ChatMessage>[]).map((m) => ({ role: m?.role === "system" || m?.role === "assistant" ? m.role : "user", content: String(m?.content ?? "") }));
    void runChat(e.sender, requestId, clean, id as ProviderId | undefined);
    return requestId;
  });
  ipcMain.handle(IPC.chatCancel, (_e, requestId: unknown) => {
    if (typeof requestId === "string") running.get(requestId)?.abort();
  });
}
