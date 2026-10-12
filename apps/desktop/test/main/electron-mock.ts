import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

type Handler = (e: { sender: FakeSender }, ...args: unknown[]) => unknown;

export class FakeSender {
  events: { channel: string; payload: unknown }[] = [];
  isDestroyed = () => false;
  send(channel: string, payload: unknown) {
    this.events.push({ channel, payload });
  }
}

export const state = {
  userData: mkdtempSync(join(tmpdir(), "point-ud-")),
  handlers: new Map<string, Handler>(),
  encryption: true,
  saveResult: { canceled: false, filePath: "" as string | undefined },
  openResult: { canceled: false, filePaths: [] as string[] }
};

/** Reversible "encryption" so tests can check the key is not stored in plain text. */
export const safeStorage = {
  isEncryptionAvailable: () => state.encryption,
  encryptString: (s: string) => Buffer.from("enc:" + Buffer.from(s).reverse().toString("hex")),
  decryptString: (b: Buffer) => Buffer.from(b.toString().slice(4), "hex").reverse().toString()
};

export function electronModule() {
  return {
    app: { getPath: () => state.userData },
    safeStorage,
    ipcMain: { handle: (ch: string, fn: Handler) => void state.handlers.set(ch, fn) },
    dialog: {
      showSaveDialog: vi.fn(async () => state.saveResult),
      showOpenDialog: vi.fn(async () => state.openResult)
    },
    BrowserWindow: { fromWebContents: () => null }
  };
}

export async function invoke(channel: string, sender: FakeSender, ...args: unknown[]) {
  const h = state.handlers.get(channel);
  if (!h) throw new Error(`no handler for ${channel}`);
  return h({ sender }, ...args);
}

export async function until(cond: () => boolean, ms = 5000) {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}
