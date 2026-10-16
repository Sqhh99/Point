import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDocx, makePdf, makeXlsx } from "../../../../packages/core/test/fixtures/make";
import { FakeSender, invoke as rawInvoke } from "./electron-mock.js";

const openPath = vi.fn<(p: string) => Promise<string>>(async () => "");
vi.mock("electron", async () => ({ ...(await import("./electron-mock.js")).electronModule(), shell: { openPath: (p: string) => openPath(p) } }));

const { IPC } = await import("../../src/shared/ipc.js");
const ws = await import("../../src/main/workspace.js");
const { registerDocsIpc } = await import("../../src/main/docs-ipc.js");
registerDocsIpc();

const invoke = (ch: string, ...a: unknown[]) => rawInvoke(ch, new FakeSender(), ...a);
const tmp = (p: string) => realpathSync.native(mkdtempSync(join(tmpdir(), p)));
let src: string;
beforeEach(() => {
  ws.openWorkspace(tmp("point-ws-"));
  src = tmp("point-src-");
  openPath.mockClear();
});

async function importAs(name: string, data: Uint8Array | string) {
  const p = join(src, name);
  writeFileSync(p, data);
  return ws.importFile(p);
}

describe("docs:view", () => {
  it("serves pdf bytes, docx html and xlsx sheets for the three formats", async () => {
    const pdf = await importAs("a.pdf", makePdf([["p1"], ["p2"]]));
    expect(await invoke(IPC.docsView, pdf.id)).toMatchObject({ kind: "pdf" });

    const docx = await importAs("b.docx", await makeDocx([{ style: "Heading1", text: "T" }]));
    const dv = (await invoke(IPC.docsView, docx.id)) as { kind: string; html: string };
    expect(dv.kind).toBe("docx");
    expect(dv.html).toContain("<h1>T</h1>");

    const x = await importAs("c.xlsx", await makeXlsx([{ name: "S1", rows: [["a"]] }, { name: "S2", rows: [["b"]] }]));
    const xv = (await invoke(IPC.docsView, x.id)) as { kind: string; sheets: { name: string }[] };
    expect(xv.sheets.map((s) => s.name)).toEqual(["S1", "S2"]);
  });

  it("rejects non-string ids and unknown docs", async () => {
    await expect(invoke(IPC.docsView, 42)).rejects.toThrow(/无效/);
    await expect(invoke(IPC.docsView, "nope")).rejects.toThrow(/不存在/);
  });

  it("an unparseable file surfaces an error the reader turns into the empty state", async () => {
    const bad = await importAs("bad.pdf", makePdf([["x"]]));
    writeFileSync(join(ws.workspacePath()!, "docs", `${bad.id}.pdf`), "garbage");
    const dv = (await invoke(IPC.docsView, bad.id)) as { kind: string };
    expect(dv.kind).toBe("pdf"); // pdf.js parses in the renderer; its failure shows DocError
  });
});

describe("docs:openExternal", () => {
  it("opens only main's stored copy of a known doc, whatever the renderer sends", async () => {
    const d = await importAs("a.pdf", makePdf([["p"]]));
    await invoke(IPC.docsOpenExternal, d.id);
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(openPath.mock.calls[0]![0]).toBe(join(ws.workspacePath()!, "docs", `${d.id}.pdf`));
  });

  it.each([["/etc/passwd"], ["../../x"], [42], [null], [{ id: "x" }]])("rejects %j without opening anything", async (bad) => {
    await expect(invoke(IPC.docsOpenExternal, bad)).rejects.toThrow();
    expect(openPath).not.toHaveBeenCalled();
  });

  it("reports an OS failure", async () => {
    const d = await importAs("a.pdf", makePdf([["p"]]));
    openPath.mockResolvedValueOnce("no app");
    await expect(invoke(IPC.docsOpenExternal, d.id)).rejects.toThrow(/无法用系统应用打开/);
  });
});
