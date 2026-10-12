import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { NoteStore, parseNote } from "../src/index.js";

let dir: string;
let store: NoteStore;
let t: number;
let n: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "point-notes-"));
  t = Date.UTC(2026, 9, 12, 8, 0, 0);
  n = 0;
  store = new NoteStore(dir, { now: () => new Date((t += 1000)), newId: () => `n${++n}` });
});

describe("NoteStore", () => {
  it("creates notes/<id>.md with YAML frontmatter", () => {
    const note = store.create({ title: "熵：笔记", body: "# 熵\n\n要点", sourceDocId: "doc-1", tags: ["物理"] });
    const raw = readFileSync(join(dir, "n1.md"), "utf8");
    expect(raw).toBe(
      "---\nid: n1\ntitle: 熵：笔记\nsourceDocId: doc-1\ncreatedAt: 2026-10-12T08:00:01.000Z\nupdatedAt: 2026-10-12T08:00:01.000Z\ntags:\n  - 物理\n---\n\n# 熵\n\n要点"
    );
    expect(store.read("n1")).toEqual(note);
  });

  it("lists newest first without bodies", () => {
    store.create({ title: "a" });
    store.create({ title: "b" });
    store.update("n1", { body: "changed" });
    expect(store.list().map((m) => [m.id, m.title, "body" in m])).toEqual([
      ["n1", "a", false],
      ["n2", "b", false]
    ]);
  });

  it("updates and appends, bumping updatedAt only", () => {
    const a = store.create({ title: "a", body: "第一段" });
    const b = store.append("n1", "第二段");
    expect(b.body).toBe("第一段\n\n第二段\n");
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.updatedAt > a.updatedAt).toBe(true);
    expect(store.update("n1", { title: "  " }).title).toBe("a");
    expect(store.append("n1", "第三段").body).toBe("第一段\n\n第二段\n\n第三段\n");
  });

  it("rejects path-like ids", () => {
    expect(() => store.read("../etc/passwd")).toThrow("无效的笔记 id");
  });

  it("skips ids that already exist", () => {
    writeFileSync(join(dir, "n1.md"), "hand-written");
    expect(store.create({ title: "x" }).id).toBe("n2");
  });

  it("parses hand-written notes without frontmatter", () => {
    expect(parseNote("# 标题\n正文", "x")).toMatchObject({ id: "x", title: "x", tags: [], body: "# 标题\n正文" });
  });
});

describe("NoteStore with number-like ids", () => {
  // randomUUID().slice(0, 8) is all digits about 2.3% of the time; YAML must keep it a string.
  it.each(["37259515", "00000001", "1234e567", "12345678"])("round-trips id %s as a string", (id) => {
    const d = mkdtempSync(join(tmpdir(), "point-notes-num-"));
    const s = new NoteStore(d, { newId: () => id });
    const note = s.create({ title: "t", body: "b" });
    const raw = readFileSync(join(d, `${id}.md`), "utf8");
    expect(raw).toMatch(new RegExp(`^---\\nid: "${id}"\\n`));
    expect(s.read(id)).toEqual(note);
    expect(s.read(id).id).toBe(id);
    expect(s.list().map((m) => m.id)).toEqual([id]);
  });
});
