import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  LLMError,
  NoteStore,
  OpenAICompatibleProvider,
  createProvider,
  docTypeOf,
  extractMermaid,
  formatExportedNote,
  noteFileName,
  parseDocument,
  parseDocx,
  parseMarkdown,
  parseNote,
  parsePdf,
  parseTaskOutput,
  serializeNote,
  validateMermaid,
  zipExportedNotes,
  type FetchLike
} from "../src/index.js";
import { errorFromStatus } from "../src/llm/errors.js";
import { sseData } from "../src/llm/sse.js";
import { makeDocx } from "./fixtures/make.js";

const enc = new TextEncoder();
const bytes = (parts: (string | Uint8Array)[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(typeof p === "string" ? enc.encode(p) : p);
      c.close();
    }
  });
const collect = async <T>(it: AsyncIterable<T>) => {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
};
const chunk = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
const provider = (fetch: FetchLike, baseURL = "https://x.test/v1/") => new OpenAICompatibleProvider({ id: "t", baseURL, apiKey: "k", fetch });
const ok = (body: ReadableStream<Uint8Array> | null) => async () => new Response(body, { status: 200 });

describe("sseData", () => {
  it("handles CRLF, multi-line data, comments and events without data", async () => {
    const out = await collect(sseData(bytes([": ping\r\n\r\nevent: x\r\n\r\ndata: a\r\ndata: b\r\n\r\n"])));
    expect(out).toEqual(["a\nb"]);
  });

  it("reassembles a UTF-8 code point split across chunks", async () => {
    const all = enc.encode("data: 熵\n\n");
    const out = await collect(sseData(bytes([all.slice(0, 7), all.slice(7)])));
    expect(out).toEqual(["熵"]);
  });

  it("flushes a final event without trailing newline", async () => {
    expect(await collect(sseData(bytes(["data: x\n\ndata: tail"])))).toEqual(["x", "tail"]);
  });

  it("keeps data without the optional space", async () => {
    expect(await collect(sseData(bytes(["data:nospace\n\n"])))).toEqual(["nospace"]);
  });
});

describe("OpenAICompatibleProvider edge cases", () => {
  it("strips trailing slashes, sends temperature/max_tokens", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    const p = provider(async (u, init) => {
      url = u;
      body = JSON.parse(init.body as string);
      return new Response(bytes(["data: [DONE]\n\n"]));
    }, "https://x.test/v1///");
    await collect(p.chat([{ role: "user", content: "q" }], { model: "m", temperature: 0, maxTokens: 5 }));
    expect(url).toBe("https://x.test/v1/chat/completions");
    expect(body).toMatchObject({ model: "m", stream: true, temperature: 0, max_tokens: 5 });
  });

  it("skips malformed JSON and empty deltas, stops at [DONE]", async () => {
    const p = provider(ok(bytes(["data: {oops\n\n", chunk(""), 'data: {"choices":[]}\n\n', chunk("A"), "data: [DONE]\n\n", chunk("after")])));
    expect((await collect(p.chat([], { model: "m" }))).map((d) => d.text)).toEqual(["A"]);
  });

  it("maps a fetch rejection to network", async () => {
    const p = provider(async () => {
      throw new TypeError("getaddrinfo ENOTFOUND");
    });
    await expect(collect(p.chat([], { model: "m" }))).rejects.toMatchObject({ code: "network" });
  });

  it("maps an abort before response to aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const p = provider(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(collect(p.chat([], { model: "m", signal: ctrl.signal }))).rejects.toMatchObject({ code: "aborted" });
  });

  it("maps an abort mid-stream to aborted and a broken stream to network", async () => {
    const ctrl = new AbortController();
    const stream = (err: Error) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(chunk("x")));
        },
        pull(c) {
          c.error(err);
        }
      });
    const it1 = provider(ok(stream(new DOMException("a", "AbortError")))).chat([], { model: "m", signal: ctrl.signal });
    await expect(collect(it1)).rejects.toMatchObject({ code: "aborted" });
    const it2 = provider(ok(stream(new Error("ECONNRESET")))).chat([], { model: "m" });
    await expect(collect(it2)).rejects.toMatchObject({ code: "network", message: expect.stringContaining("ECONNRESET") });
  });

  it("errors when the response has no body", async () => {
    await expect(collect(provider(ok(null)).chat([], { model: "m" }))).rejects.toMatchObject({ code: "server" });
  });

  it("maps 403/500/400 and truncates long error bodies", async () => {
    expect(errorFromStatus(403, "").code).toBe("auth");
    expect(errorFromStatus(503, "").code).toBe("server");
    expect(errorFromStatus(400, "x".repeat(2000)).message.length).toBeLessThan(600);
    const p = provider(async () => new Response("limit", { status: 429 }));
    const err = await collect(p.chat([], { model: "m" })).catch((e) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err).toMatchObject({ code: "rate_limit", status: 429 });
  });

  it("shows only the status and the vendor's error.message, never the raw JSON body", () => {
    const body = JSON.stringify({ error: { message: "Authentication Fails, Your api key: ****abcd is invalid", type: "authentication_error", param: null, code: "invalid_request_error" } });
    const e = errorFromStatus(401, body);
    expect(e.code).toBe("auth");
    expect(e.message).toBe("鉴权失败 (401): Authentication Fails, Your api key: ****abcd is invalid");
    expect(e.message).not.toContain("{");
    expect(e.message).not.toContain("authentication_error");
    expect(errorFromStatus(502, "<html>bad gateway</html>").message).toBe("服务端错误 (502)");
    expect(errorFromStatus(400, JSON.stringify({ message: "bad model" })).message).toBe("请求错误 (400): bad model");
  });

  it("createProvider rejects unknown ids and honours a custom baseURL", async () => {
    expect(() => createProvider({ id: "nope" as "glm", apiKey: "k" })).toThrow(/未知/);
    let url = "";
    const p = createProvider({ id: "glm", apiKey: "k", baseURL: "https://proxy.test", fetch: async (u) => ((url = u), new Response(bytes([]))) });
    await collect(p.chat([], { model: "m" }));
    expect(url).toBe("https://proxy.test/chat/completions");
  });
});

describe("mermaid validation / extraction", () => {
  it.each([
    ["", "图表为空"],
    ["%% only comment", "图表为空"],
    ["bogus\nA-->B", "未知的图表类型: bogus"],
    ["flowchart TD", "图表没有内容"],
    ["flowchart TD\nA[x --> B", "括号不匹配"],
    ["flowchart TD\nA(x] --> B", "括号不匹配"],
    ["flowchart TD\nA] --> B", "括号不匹配"]
  ])("rejects %j", (code, error) => {
    expect(validateMermaid(code)).toEqual({ valid: false, error });
  });

  it("ignores brackets inside quotes and accepts single-line pie", () => {
    expect(validateMermaid('flowchart TD\nA["f(x"] --> B').valid).toBe(true);
    expect(validateMermaid('pie title "x"').valid).toBe(true);
  });

  it("extracts tilde and indented fences, several blocks in order", () => {
    const text = "~~~mermaid\ngraph LR\nA-->B\n~~~\n\n  ```mermaid\nmindmap\n  root\n  ```";
    expect(extractMermaid(text).map((b) => b.code.split("\n")[0])).toEqual(["graph LR", "mindmap"]);
  });

  it("diagram output: malformed bare text stays unfenced, invalid fenced block is flagged", () => {
    expect(parseTaskOutput("diagram", "抱歉，无法绘制")).toEqual({ markdown: "抱歉，无法绘制", mermaid: [] });
    const r = parseTaskOutput("diagram", "```mermaid\nflowchart TD\nA[x --> B\n```");
    expect(r.mermaid[0]).toMatchObject({ valid: false, error: "括号不匹配" });
    expect(parseTaskOutput("explain", "flowchart TD\nA-->B").mermaid).toEqual([]);
  });
});

describe("notes frontmatter round-trip", () => {
  const base = { id: "n1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" };

  it("round-trips CJK, emoji and YAML-hostile titles/tags", () => {
    const n = { ...base, title: 'a: "b" #c — 熵 🧪', tags: ["- x", "yes", "中文"], sourceDocId: "d", body: "---\n正文\n" };
    expect(parseNote(serializeNote(n), "f")).toEqual(n);
  });

  it("handles missing / empty / CRLF frontmatter", () => {
    expect(parseNote("just body", "f")).toMatchObject({ id: "f", title: "f", tags: [], body: "just body" });
    expect(parseNote("---\n\n---\nB", "f")).toMatchObject({ id: "f", body: "B" });
    expect(parseNote("---\r\ntitle: T\r\n---\r\nB", "f")).toMatchObject({ title: "T", body: "B" });
  });

  it("coerces YAML timestamps and drops non-string tags", () => {
    const n = parseNote("---\ncreatedAt: 2026-01-01T00:00:00Z\ntags: [a, 1, null]\n---\n", "f");
    expect(n.tags).toEqual(["a"]);
    expect(n.updatedAt).toBe(n.createdAt);
  });

  it("NoteStore: list ignores foreign files, sorts by updatedAt, id collisions retried", () => {
    const dir = mkdtempSync(join(tmpdir(), "point-notes-"));
    writeFileSync(join(dir, "bad name.md"), "x");
    writeFileSync(join(dir, "readme.txt"), "x");
    const ids = ["a", "a", "b"];
    let t = 0;
    const s = new NoteStore(dir, { newId: () => ids.shift()!, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)) });
    s.create({ title: "  " });
    const b = s.create({ title: "B" });
    expect(b.id).toBe("b");
    expect(s.list().map((m) => m.id)).toEqual(["b", "a"]);
    expect(s.read("a").title).toBe("未命名笔记");
    expect(s.update("a", { title: " " }).title).toBe("未命名笔记");
    expect(s.append("a", "x").body).toBe("x\n");
    expect(() => s.read("zz")).toThrow(/不存在/);
  });
});

describe("export edge cases", () => {
  it("accepts Date exportedAt and omits source when unknown", () => {
    const md = formatExportedNote({ title: "T", tags: [], body: "\n\nB" }, { exportedAt: new Date(0) });
    expect(md).toBe("---\ntitle: T\ntags: []\nexported_at: 1970-01-01T00:00:00.000Z\n---\n\nB");
  });

  it("noteFileName strips reserved characters and trailing dots, keeps CJK", () => {
    expect(noteFileName('a/b\\c:d*e?"f<g>h|', "id")).toBe("a_b_c_d_e__f_g_h_.md");
    expect(noteFileName("量子   纠缠...", "id")).toBe("量子 纠缠.md");
    expect(noteFileName(" ... ", "id")).toBe("id.md");
    expect(noteFileName("长".repeat(200), "id").length).toBe(83);
  });

  it("zip adds .md and dedupes repeated names", async () => {
    const buf = await zipExportedNotes([
      { fileName: "a", markdown: "1" },
      { fileName: "a.md", markdown: "2" },
      { fileName: "a.md", markdown: "3" }
    ]);
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files).sort()).toEqual(["a-2.md", "a-3.md", "a.md"]);
    expect(await zip.file("a-3.md")!.async("string")).toBe("3");
  });
});

describe("doc parser edge cases", () => {
  it("docTypeOf is case-insensitive and rejects unknown/no extension", () => {
    expect(docTypeOf("A.MARKDOWN")).toBe("md");
    expect(docTypeOf("x.DOCX")).toBe("docx");
    expect(docTypeOf("x.txt")).toBeUndefined();
  });

  it("docTypeOf: extension-less names are not documents", () => {
    expect(docTypeOf("pdf")).toBeUndefined();
    expect(docTypeOf("md")).toBeUndefined();
    expect(docTypeOf("docx")).toBeUndefined();
    expect(docTypeOf("/tmp/a.pdf/notes")).toBeUndefined();
    expect(docTypeOf("C:\\docs.v2\\pdf")).toBeUndefined();
    expect(docTypeOf("/tmp/dir/paper.pdf")).toBe("pdf");
  });

  it("empty markdown gives no blocks and the fallback title", async () => {
    const d = await parseDocument("md", new Uint8Array(), "空");
    expect(d).toMatchObject({ title: "空", blocks: [], outline: [] });
  });

  it("markdown: blockquote flattened, raw html kept as text, lone image, title from first heading", () => {
    const d = parseMarkdown("## 次级\n\n> 引用\n\n<div>raw</div>\n\n![图](x.png)\n");
    expect(d.title).toBe("次级");
    expect(d.blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "paragraph", "image"]);
    expect(d.blocks[2]).toMatchObject({ text: "<div>raw</div>" });
  });

  // Tiny fixed corrupt samples. The first call cold-loads the zip / pdf.js
  // parsers, which can exceed vitest's 5s default on Windows runners, so
  // these cases get their own 20s budget; they still must reject.
  const CORRUPT_TIMEOUT = 20_000;
  const NOT_ZIP = new Uint8Array([0x6e, 0x6f, 0x74, 0x7a]); // "notz"
  const TRUNCATED_ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04" header only
  const BAD_PDF = enc.encode("%PDF-1.4\n%%EOF");

  it.each([
    ["empty", new Uint8Array()],
    ["not a zip", NOT_ZIP],
    ["truncated zip header", TRUNCATED_ZIP],
  ])("corrupt docx (%s) rejects instead of hanging", async (_n, bytes) => {
    await expect(parseDocx(bytes)).rejects.toThrow();
  }, CORRUPT_TIMEOUT);

  it.each([
    ["empty", new Uint8Array()],
    ["header + EOF only", BAD_PDF],
  ])("corrupt pdf (%s) rejects instead of hanging", async (_n, bytes) => {
    await expect(parsePdf(bytes)).rejects.toThrow();
  }, CORRUPT_TIMEOUT);

  it("docx via parseDocument unescapes markdown punctuation", async () => {
    const d = await parseDocument("docx", await makeDocx([{ text: "1. a*b (c)" }]), "f");
    expect(d.blocks.map((b) => ("text" in b ? b.text : ""))).toContain("1. a*b (c)");
  });
});
