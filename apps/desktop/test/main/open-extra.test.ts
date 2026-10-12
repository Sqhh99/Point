import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSender, invoke, state, until } from "./electron-mock.js";

vi.mock("electron", async () => (await import("./electron-mock.js")).electronModule());

const electron = (await import("electron")) as unknown as { dialog: { showErrorBox: ReturnType<typeof vi.fn> } };
const { IPC } = await import("../../src/shared/ipc.js");
const ws = await import("../../src/main/workspace.js");
const { registerOpenIpc, openPath, resolveOpenTarget, scratchRoot, interceptDrops } = await import("../../src/main/open-ipc.js");
registerOpenIpc();

// .native: on Windows runners tmpdir() is an 8.3 short path (RUNNER~1); the app returns the long form.
const tmp = (p: string) => realpathSync.native(mkdtempSync(join(tmpdir(), p)));
const s = () => new FakeSender();
type OpenResult = import("../../src/shared/ipc.js").OpenResult;
type RecentItem = import("../../src/shared/ipc.js").RecentItem;
const openAt = (i: unknown, expected?: unknown) => invoke(IPC.openRecentAt, s(), i, expected) as Promise<OpenResult>;
const MISSING = "找不到这个文件，可能已被移动或删除。";
const recentPaths = async () => ((await invoke(IPC.openRecent, s())) as RecentItem[]).map((r) => r.path);
const file = (name = "a.md", body = "# 标题\n\n正文") => {
  const f = join(tmp("point-src-"), name);
  writeFileSync(f, body);
  return f;
};
// Case-insensitive volumes (default on macOS APFS and Windows NTFS); Linux CI is case-sensitive.
const probe = file("CaseProbe.md");
const caseInsensitive = existsSync(probe.replace("CaseProbe", "caseprobe"));
const canSymlink = (() => {
  try {
    symlinkSync(probe, join(tmp("point-ln-"), "p.md"));
    return true;
  } catch {
    return false; // Windows without developer mode / admin
  }
})();

afterAll(() => ws.closeWorkspace());
beforeEach(() => {
  ws.closeWorkspace();
  writeFileSync(join(state.userData, "recent.json"), "[]");
  electron.dialog.showErrorBox.mockClear();
});

describe("resolveOpenTarget: path forms", () => {
  it("raw `..` segments (not pre-normalized) resolve to the real target", () => {
    const f = file("x.md");
    const parts = f.split(sep);
    const raw = [...parts.slice(0, -1), "sub", "..", "..", parts.at(-2), parts.at(-1)].join(sep);
    expect(raw).toContain(`${sep}..${sep}`);
    expect(resolveOpenTarget(raw)).toEqual({ kind: "file", path: f });
  });

  it("an absolute path outside any workspace is allowed (only user-chosen paths reach here)", () => {
    const root = tmp("point-ws-");
    ws.openWorkspace(root);
    const f = file("outside.md");
    expect(resolveOpenTarget(f)).toEqual({ kind: "file", path: f });
  });

  it("a directory becomes a workspace target", () => {
    const d = tmp("point-dir-");
    expect(resolveOpenTarget(d)).toEqual({ kind: "workspace", path: d });
  });

  it.each([["报告 📊.md"], ["café.md"], ["空 格.md"], ["中文名.csv"]])("unicode/emoji file name %s", (n) => {
    const f = file(n, n.endsWith(".csv") ? "a,b" : "# x");
    expect(resolveOpenTarget(f).path).toBe(f);
  });

  it("nonexistent file and nonexistent parent → 找不到", () => {
    const d = tmp("point-src-");
    expect(() => resolveOpenTarget(join(d, "nope.md"))).toThrow("找不到");
    expect(() => resolveOpenTarget(join(d, "no", "such", "dir", "a.md"))).toThrow("找不到");
  });

  it("a very long path is rejected cleanly, not with a raw ENAMETOOLONG", () => {
    const long = join(tmp("point-src-"), "a".repeat(5000) + ".md");
    expect(() => resolveOpenTarget(long)).toThrow("找不到");
  });

  it.each([["\0"], ["a\0.md"], ["\0/etc/passwd"]])("NUL anywhere is rejected: %j", (p) => {
    expect(() => resolveOpenTarget(join(tmp("point-src-"), p))).toThrow("无效的路径");
  });

  it.each([[undefined], [[]], [true], [new String("/tmp")], [Symbol("x")]])("non-string %s rejected", (p) => {
    expect(() => resolveOpenTarget(p)).toThrow("无效的路径");
  });

  it.runIf(process.platform !== "win32")("Windows-style paths are not absolute on POSIX", () => {
    for (const p of ["C:\\Users\\a.md", "C:/a.md", "\\\\server\\share\\a.md", "a\\..\\b.md"]) expect(() => resolveOpenTarget(p)).toThrow("无效的路径");
  });

  it.runIf(process.platform === "win32")("Windows: drive-relative and mixed separators", () => {
    const f = file("w.md");
    expect(() => resolveOpenTarget("C:a.md")).toThrow("无效的路径");
    expect(resolveOpenTarget(f.replace(/\\/g, "/")).path).toBe(f);
  });

  it.runIf(process.platform !== "win32")("POSIX: trailing dot/space is a different, unsupported name", () => {
    for (const n of ["t.pdf.", "t.md "]) expect(() => resolveOpenTarget(file(n))).toThrow("不支持的文件类型");
  });

  // Win32 strips trailing dots/spaces, so `t.md.` names t.md. Either outcome is acceptable — open t.md,
  // or reject as unsupported — but it must never crash or open some other file.
  it.runIf(process.platform === "win32")("Windows: trailing dot/space never opens another file", () => {
    const f = file("t.md");
    for (const p of [f + ".", f + " "]) {
      let r: { kind: string; path: string } | undefined;
      try {
        r = resolveOpenTarget(p);
      } catch (e) {
        expect(String(e)).toMatch(/不支持的文件类型|找不到/);
      }
      if (r) expect(r.path.toLowerCase().replace(/[. ]+$/, "")).toBe(f.toLowerCase());
    }
  });
});

describe.runIf(canSymlink)("resolveOpenTarget: symlinks", () => {
  it("file symlink pointing outside resolves to the target", () => {
    const f = file("real.md");
    const l = join(tmp("point-ln-"), "l.md");
    symlinkSync(f, l);
    expect(resolveOpenTarget(l)).toEqual({ kind: "file", path: f });
  });
  it("dir symlink pointing outside resolves to the target dir", () => {
    const d = tmp("point-dir-");
    const l = join(tmp("point-ln-"), "d");
    symlinkSync(d, l, "dir");
    expect(resolveOpenTarget(l)).toEqual({ kind: "workspace", path: d });
  });
  it("symlink to a file inside scratch is rejected", () => {
    mkdirSync(scratchRoot(), { recursive: true });
    const inner = join(scratchRoot(), "inner.md");
    writeFileSync(inner, "# x");
    const l = join(tmp("point-ln-"), "l.md");
    symlinkSync(inner, l);
    expect(() => resolveOpenTarget(l)).toThrow("无效的路径");
    expect(() => resolveOpenTarget(inner)).toThrow("无效的路径");
  });
  it("a symlink loop fails fast with 找不到", () => {
    const d = tmp("point-ln-");
    symlinkSync(join(d, "b.md"), join(d, "a.md"));
    symlinkSync(join(d, "a.md"), join(d, "b.md"));
    expect(() => resolveOpenTarget(join(d, "a.md"))).toThrow("找不到");
  });
  it("a dangling symlink → 找不到", () => {
    const d = tmp("point-ln-");
    symlinkSync(join(d, "gone.md"), join(d, "l.md"));
    expect(() => resolveOpenTarget(join(d, "l.md"))).toThrow("找不到");
  });
});

describe.runIf(caseInsensitive)("resolveOpenTarget: case variants on case-insensitive volumes", () => {
  const variant = (p: string) => p.replace(/scratch$/, "SCRATCH");
  it("a file name with different case opens the real file", () => {
    const f = file("Mixed.md");
    expect(resolveOpenTarget(f.replace("Mixed", "mixed")).kind).toBe("file");
  });
  // Was a macOS bug (realpathSync kept the caller's casing); fixed with realpathSync.native.
  it("scratch opened with different case is still rejected", () => {
    mkdirSync(scratchRoot(), { recursive: true });
    expect(() => resolveOpenTarget(variant(scratchRoot()))).toThrow("无效的路径");
  });
});

describe("recent by index (extra)", () => {
  async function seed(n: number) {
    const files = Array.from({ length: n }, (_, i) => file(`r${i}.md`));
    for (const f of files) await openPath(f);
    ws.closeWorkspace();
    return files.reverse(); // newest first, like the list
  }
  it.each([[-1], [-0.5], [1.5], [NaN], [Infinity], [-Infinity], ["0"], [" 0"], [[0]], [{ valueOf: (): number => 0 }], [undefined], [2 ** 53], [3]])(
    "rejects %s",
    async (i) => {
      const [first] = await seed(3);
      await expect(openAt(i, first)).rejects.toThrow("无效的最近记录");
    }
  );
  it("-0 is index 0", async () => {
    const files = await seed(2);
    const r = await openAt(-0, files[0]);
    expect(r.doc?.type).toBe("md");
    expect((await recentPaths())[0]).toBe(files[0]);
  });
  it("an entry whose file was deleted disappears from the list", async () => {
    const [newest] = await seed(2);
    rmSync(newest!);
    const recent = await recentPaths();
    expect(recent).not.toContain(newest);
    expect(recent).toHaveLength(1);
  });
  it("clicking an entry whose file was moved shows the missing copy and drops it from the list", async () => {
    const [newest] = await seed(2);
    renameSync(newest!, newest + ".bak");
    await expect(openAt(0, newest)).rejects.toThrow(MISSING);
    expect(await recentPaths()).not.toContain(newest);
    renameSync(newest + ".bak", newest!);
    // it was removed, so even after moving back it stays out until opened again
    expect(await recentPaths()).not.toContain(newest);
  });

  it("a right index with the wrong / missing expected path is refused", async () => {
    const [a, b] = await seed(2);
    for (const exp of [b, undefined, null, 0, "/not/in/recent.md"]) await expect(openAt(0, exp)).rejects.toThrow("无效的最近记录");
    expect((await openAt(0, a)).doc?.type).toBe("md");
  });
  it("a stale index never opens a different file than the one shown", async () => {
    const [a, b, c] = await seed(3);
    const shown = await recentPaths();
    expect(shown).toEqual([a, b, c]);
    rmSync(a!); // user deletes the newest file while the menu is open
    await expect(openAt(1, b)).rejects.toThrow("无效的最近记录"); // index 1 is now c: refused, not opened
    expect(await recentPaths()).toEqual([b, c]);
    expect(ws.workspacePath()).toBeNull();
  });
});

describe("drag-drop via will-navigate", () => {
  function fakeWin() {
    let handler!: (e: { preventDefault: () => void }, url: string) => void;
    const send = vi.fn();
    const win = { webContents: { on: (_ev: string, fn: typeof handler) => void (handler = fn), isDestroyed: () => false, send } };
    interceptDrops(win as never);
    const nav = (url: string) => {
      const e = { preventDefault: vi.fn() };
      handler(e, url);
      return e;
    };
    return { nav, send };
  }
  const settle = () => new Promise((r) => setTimeout(r, 50));

  it.each([
    ["http://example.com/a.md"], ["https://evil.test/"], ["javascript:alert(1)"], ["data:text/html,<script>1</script>"],
    ["about:blank"], ["blob:null/abc"], ["chrome://settings"], ["FILE-ish:/x"], [" file:///tmp/a.md"]
  ])("%s is blocked and opens nothing", async (url) => {
    const { nav, send } = fakeWin();
    const e = nav(url);
    expect(e.preventDefault).toHaveBeenCalledOnce();
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(electron.dialog.showErrorBox).not.toHaveBeenCalled();
    expect(ws.workspacePath()).toBeNull();
  });

  it("a dropped file opens and the renderer is told", async () => {
    const f = file("drop.md");
    const { nav, send } = fakeWin();
    expect(nav(pathToFileURL(f).href).preventDefault).toHaveBeenCalledOnce();
    await until(() => send.mock.calls.length > 0);
    expect(send).toHaveBeenCalledWith(IPC.openOpened, expect.objectContaining({ doc: expect.objectContaining({ type: "md" }) }));
  });

  it("a dropped folder becomes the workspace", async () => {
    const d = tmp("point-ws-");
    const { nav, send } = fakeWin();
    nav(pathToFileURL(d).href);
    await until(() => send.mock.calls.length > 0);
    expect(ws.workspacePath()).toBe(d);
  });

  it("encoded %2e%2e is resolved by the URL parser to the real normalized path", async () => {
    const f = file("enc.md");
    const parts = pathToFileURL(f).href.split("/");
    const url = [...parts.slice(0, -1), "sub", "%2e%2e", parts.at(-1)].join("/");
    const { nav, send } = fakeWin();
    nav(url);
    await until(() => send.mock.calls.length > 0);
    expect((await recentPaths())[0]).toBe(f);
  });

  it("a dropped unsupported file shows an error box and opens nothing", async () => {
    const f = file("x.exe", "MZ");
    const { nav, send } = fakeWin();
    nav(pathToFileURL(f).href);
    await until(() => electron.dialog.showErrorBox.mock.calls.length > 0);
    expect(electron.dialog.showErrorBox.mock.calls[0]![1]).toContain("不支持的文件类型");
    expect(send).not.toHaveBeenCalled();
  });

  it.runIf(process.platform !== "win32")("file URL with a remote host is ignored", async () => {
    const { nav, send } = fakeWin();
    nav("file://evil-host/etc/passwd");
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(electron.dialog.showErrorBox).not.toHaveBeenCalled();
  });

  it("file URL with an encoded NUL is rejected", async () => {
    const { nav, send } = fakeWin();
    nav(pathToFileURL(file("n.md")).href.replace("n.md", "n%00.md"));
    await settle();
    expect(send).not.toHaveBeenCalled();
  });
});
