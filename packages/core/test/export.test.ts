import { describe, expect, it } from "vitest";
import { formatConversationMarkdown, formatExportedNote, noteFileName } from "../src/notes/export.js";

describe("formatExportedNote", () => {
  it("writes title / tags / source / exported_at and leaves the body alone", () => {
    const md = formatExportedNote(
      { title: "熵：笔记", tags: ["物理", "热力学"], body: "## 定义\n\n熵是无序度。\n" },
      { source: "热力学导论", exportedAt: "2026-10-12T10:00:00.000Z" }
    );
    expect(md).toBe(
      "---\ntitle: 熵：笔记\ntags:\n  - 物理\n  - 热力学\nsource: 热力学导论\nexported_at: 2026-10-12T10:00:00.000Z\n---\n\n## 定义\n\n熵是无序度。\n"
    );
  });

  it("omits source when unknown and keeps an empty tags list", () => {
    const md = formatExportedNote({ title: "x", tags: [], body: "正文" }, { exportedAt: "2026-01-01T00:00:00.000Z" });
    expect(md.startsWith("---\ntitle: x\ntags: []\nexported_at:")).toBe(true);
    expect(md).not.toContain("source:");
    expect(md.endsWith("---\n\n正文")).toBe(true);
  });
});

describe("noteFileName", () => {
  it("keeps CJK, strips path-hostile characters, falls back to id", () => {
    expect(noteFileName("熵：笔记 / 草稿?", "n1")).toBe("熵：笔记 _ 草稿_.md");
    expect(noteFileName("   ", "n1")).toBe("n1.md");
    expect(noteFileName("a".repeat(100), "n1").length).toBe(80 + 3);
  });
});

describe("formatConversationMarkdown", () => {
  it("renders quote + Q/A turns", () => {
    const md = formatConversationMarkdown(
      "解读概念：熵",
      [
        { role: "user", content: "解读概念", quote: "熵是无序度", source: "《热力学导论》" },
        { role: "assistant", content: "熵度量无序。" }
      ],
      new Date("2026-10-12T10:00:00Z")
    );
    expect(md).toContain("title: 解读概念：熵");
    expect(md).toContain("type: conversation");
    expect(md).toContain("### 我\n\n> 熵是无序度\n>\n> — 《热力学导论》\n\n解读概念");
    expect(md).toContain("### AI\n\n熵度量无序。");
  });
});

describe("zipExportedNotes", () => {
  it("packs notes and disambiguates colliding file names", async () => {
    const { zipExportedNotes } = await import("../src/notes/export.js");
    const bytes = await zipExportedNotes([
      { fileName: "同名.md", markdown: "a" },
      { fileName: "同名.md", markdown: "b" }
    ]);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).sort()).toEqual(["同名-2.md", "同名.md"]);
    expect(await zip.file("同名.md")!.async("string")).toBe("a");
    expect(await zip.file("同名-2.md")!.async("string")).toBe("b");
  });
});
