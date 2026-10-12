import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSender, invoke, state } from "./electron-mock.js";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());

const { IPC } = await import("../../src/shared/ipc.js");
const ws = await import("../../src/main/workspace.js");
const { registerOpenIpc, openPath, resolveOpenTarget, scratchRoot } = await import("../../src/main/open-ipc.js");
const { pushRecent, RECENT_MAX } = await import("../../src/main/recent.js");
registerOpenIpc();

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const s = () => new FakeSender();
const mdFile = (name = "a.md") => {
  const f = join(tmp("point-src-"), name);
  writeFileSync(f, "# 标题\n\n正文");
  return f;
};

afterAll(() => ws.closeWorkspace());
beforeEach(() => {
  ws.closeWorkspace();
  writeFileSync(join(state.userData, "recent.json"), "[]");
});

describe("single-file mode", () => {
  it("opening a file without a workspace uses the private scratch workspace", async () => {
    state.openResult = { canceled: false, filePaths: [mdFile()] };
    const r = await invoke(IPC.openFile, s());
    expect(r.workspace.path).toBe(scratchRoot());
    expect(r.doc).toMatchObject({ type: "md", title: "标题" });
    expect(ws.listDocs()).toHaveLength(1);
  });

  it("opening a file with a workspace open imports it there", async () => {
    const root = tmp("point-ws-");
    ws.openWorkspace(root);
    const r = await openPath(mdFile());
    expect(r.workspace.path).toBe(root);
    expect(r.doc?.type).toBe("md");
  });

  it("a dropped folder becomes the workspace and is remembered; scratch is not", async () => {
    const root = tmp("point-ws-");
    await openPath(mdFile());
    await openPath(root);
    expect(ws.workspacePath()).toBe(root);
    const recent = await invoke(IPC.openRecent, s());
    expect(recent.map((x: { kind: string }) => x.kind)).toEqual(["workspace", "file"]);
    expect(recent.some((x: { path: string }) => x.path === scratchRoot())).toBe(false);
  });

  it("cancel leaves everything as it was", async () => {
    state.openResult = { canceled: true, filePaths: [] };
    expect(await invoke(IPC.openFile, s())).toEqual({ workspace: { path: null } });
    expect(await invoke(IPC.openWorkspace, s())).toEqual({ workspace: { path: null } });
  });
});

describe("openPath rejects untrusted input", () => {
  it.each([[""], ["relative/a.md"], [null], [42], [{}], ["/tmp/a\0.md"]])("%j", async (p) => {
    await expect(openPath(p)).rejects.toThrow("无效的路径");
  });
  it("missing paths and unsupported files", async () => {
    await expect(openPath(join(tmpdir(), "nope-" + Date.now() + ".md"))).rejects.toThrow("找不到");
    const exe = join(tmp("point-src-"), "x.exe");
    writeFileSync(exe, "MZ");
    await expect(openPath(exe)).rejects.toThrow("不支持的文件类型");
  });
  it("the scratch folder itself cannot be opened as a workspace", async () => {
    mkdirSync(scratchRoot(), { recursive: true });
    await expect(openPath(scratchRoot())).rejects.toThrow("无效的路径");
  });
});

describe("resolveOpenTarget", () => {
  it("resolves symlinks before checking", async () => {
    const { symlinkSync } = await import("node:fs");
    mkdirSync(scratchRoot(), { recursive: true });
    const link = join(tmp("point-ln-"), "s");
    symlinkSync(scratchRoot(), link);
    expect(() => resolveOpenTarget(link)).toThrow("无效的路径");
    const f = mdFile();
    const l2 = join(tmp("point-ln-"), "b.md");
    symlinkSync(f, l2);
    expect(resolveOpenTarget(l2)).toEqual({ kind: "file", path: (await import("node:fs")).realpathSync(f) });
  });
});

describe("recent by index", () => {
  it("opens main's own entry and rejects bad indexes", async () => {
    const f = mdFile();
    await openPath(f);
    ws.closeWorkspace();
    const r = await invoke(IPC.openRecentAt, s(), 0);
    expect(r.doc?.type).toBe("md");
    for (const bad of [-1, 1, 99, 0.5, "0", null, "/etc/passwd"]) await expect(invoke(IPC.openRecentAt, s(), bad)).rejects.toThrow("无效的最近记录");
  });
});

describe("recent list", () => {
  const it0 = (path: string, kind: "workspace" | "file" = "file") => ({ kind, path, name: path, openedAt: "t" });
  it("newest first, deduped, capped", () => {
    let l = [] as ReturnType<typeof pushRecent>;
    for (const p of ["/a", "/b", "/a", "/c", "/d", "/e", "/f"]) l = pushRecent(l, it0(p));
    expect(l.map((x) => x.path)).toEqual(["/f", "/e", "/d", "/c", "/a"]);
    expect(l).toHaveLength(RECENT_MAX);
  });
  it("same path as file and as workspace are separate entries", () => {
    expect(pushRecent([it0("/a", "workspace")], it0("/a"))).toHaveLength(2);
  });
  it("a corrupt recent.json reads as empty", async () => {
    writeFileSync(join(state.userData, "recent.json"), "{ bad");
    expect(await invoke(IPC.openRecent, s())).toEqual([]);
  });
});
