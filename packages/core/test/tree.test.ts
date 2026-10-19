import { describe, expect, it } from "vitest";
import { branchCounts, groupBySpan, branchesFrom, defaultLeaf, latestLeaf, siblingsOf, branchTree, breadcrumb, locateOrigin, mainLeaf, pathTo, spanMatches, sourceSpanOf, type BranchOrigin, type TreeNode } from "../src/index.js";

// main: u1 → a1 → u2 → a2 ; branch b1 from a1 ; sub-branch b2 from b1's answer
const n = (id: string, parentId: string | null, t: number): TreeNode => ({ id, parentId, createdAt: `2026-10-12T00:00:${String(t).padStart(2, "0")}Z` });
const nodes = [n("u1", null, 1), n("a1", "u1", 2), n("u2", "a1", 3), n("a2", "u2", 4), n("b1", "a1", 5), n("b1a", "b1", 6), n("b2", "b1a", 7), n("b2a", "b2", 8)];
const origins: BranchOrigin[] = [
  { childId: "b1", sourceId: "a1", start: 0, end: 1, quote: "熵" },
  { childId: "b2", sourceId: "b1a", start: 2, end: 5, quote: "互信息" }
];

describe("conversation tree", () => {
  it("context is the root→leaf path only, never sibling branches", () => {
    expect(pathTo(nodes, "b2a").map((x) => x.id)).toEqual(["u1", "a1", "b1", "b1a", "b2", "b2a"]);
    expect(pathTo(nodes, "a2").map((x) => x.id)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("main thread skips branches", () => {
    expect(mainLeaf(nodes, origins)?.id).toBe("a2");
    expect(mainLeaf(nodes, origins, "b1")?.id).toBe("b1a");
  });

  it("breadcrumb and branch tree follow nested branches", () => {
    expect(breadcrumb(nodes, origins, "b2a")).toEqual([{}, { branchId: "b1", quote: "熵" }, { branchId: "b2", quote: "互信息" }]);
    const tree = branchTree(nodes, origins);
    expect(tree.map((t) => t.branchId)).toEqual(["b1"]);
    expect(tree[0].children.map((t) => t.branchId)).toEqual(["b2"]);
    expect(branchCounts(origins).get("a1")).toBe(1);
  });

  it("orphans and cycles do not break anything", () => {
    const broken = [...nodes.filter((x) => x.id !== "b1"), n("x", "y", 9), n("y", "x", 10)];
    expect(pathTo(broken, "b2a").map((x) => x.id)).toEqual(["b1a", "b2", "b2a"]);
    expect(pathTo(broken, "x").length).toBe(2);
    expect(pathTo(broken, "missing")).toEqual([]);
    expect(branchTree(broken, origins).map((t) => t.branchId)).toEqual(["b2"]);
    expect(breadcrumb(broken, origins, "b2a")).toEqual([{}, { branchId: "b2", quote: "互信息" }]);
  });

  it("spans are UTF-16 [start, end) over the stored markdown, emoji included", () => {
    const md = "**熵**是🙂的度量";
    expect(spanMatches(md, 2, 3, "熵")).toBe(true);
    expect(spanMatches(md, 6, 8, "🙂")).toBe(true);
    expect(spanMatches(md, 6, 7, "🙂")).toBe(false);
    expect(spanMatches(md, 3, 3, "")).toBe(false);
    expect(spanMatches(md, 0, 99, md)).toBe(false);
  });

  it("relocates by quote when offsets drift, nearest occurrence wins", () => {
    expect(locateOrigin("熵 A 熵 B 熵", { start: 5, end: 6, quote: "熵" })).toEqual({ start: 4, end: 5 });
    expect(locateOrigin("abc", { start: 0, end: 1, quote: "z" })).toBeNull();
  });
});

describe("siblings and default leaf (⑥)", () => {
  const n = (id: string, parentId: string | null, t: string) => ({ id, parentId, createdAt: t });
  // q1 → a1, a2 (regenerated), a3; a2 → q2 → b1; a1 has span branch s1; root q0 re-asked as q1.
  const nodes = [n("q0", null, "0"), n("q1", null, "1"), n("a1", "q1", "2"), n("a2", "q1", "3"), n("q2", "a2", "4"), n("b1", "q2", "5"), n("s1", "a1", "6"), n("a3", "q1", "7")];
  const origins = [{ childId: "s1", sourceId: "a1", start: 0, end: 1, quote: "x" }];
  it("siblingsOf lists alternatives oldest first, excluding span branches", () => {
    expect(siblingsOf(nodes, origins, "a2").map((m) => m.id)).toEqual(["a1", "a2", "a3"]);
    expect(siblingsOf(nodes, origins, "q1").map((m) => m.id)).toEqual(["q0", "q1"]);
    expect(siblingsOf(nodes, origins, "s1").map((m) => m.id)).toEqual(["s1"]);
    expect(siblingsOf(nodes, origins, "nope")).toEqual([]);
  });
  it("latestLeaf follows the newest non-branch child; defaultLeaf starts at the newest root", () => {
    expect(latestLeaf(nodes, origins, "a2")!.id).toBe("b1");
    expect(latestLeaf(nodes, origins, "a1")!.id).toBe("a1");
    expect(defaultLeaf(nodes, origins)!.id).toBe("a3");
    expect(defaultLeaf([], [])).toBeUndefined();
  });
  it("switching to a sibling shows that branch's descendants", () => {
    const leaf = latestLeaf(nodes, origins, "a2")!.id;
    expect(pathTo(nodes, leaf).map((m) => m.id)).toEqual(["q1", "a2", "q2", "b1"]);
  });
  it("branchesFrom counts only the shown answer's branches", () => {
    expect(branchesFrom(origins, "a1")).toHaveLength(1);
    expect(branchesFrom(origins, "a2")).toHaveLength(0);
  });
  it("cycles terminate", () => {
    const cyc = [n("x", "y", "1"), n("y", "x", "2")];
    expect(latestLeaf(cyc, [], "x")).toBeDefined();
  });
});

describe("siblingsOf for span-branch questions (fix/fork-sibling)", () => {
  const n = (id: string, parentId: string | null, t: string) => ({ id, parentId, createdAt: t });
  const nodes = [n("q", null, "0"), n("a", "q", "1"), n("b1", "a", "2"), n("b2", "a", "3"), n("x", "a", "4")];
  const o = (childId: string, start: number, quote: string) => ({ childId, sourceId: "a", start, end: start + quote.length, quote });
  it("questions forked from the identical span are alternatives; a different span is not", () => {
    const origins = [o("b1", 0, "熵"), o("b2", 0, "熵"), o("x", 2, "熵")];
    expect(siblingsOf(nodes, origins, "b2").map((m) => m.id)).toEqual(["b1", "b2"]);
    expect(siblingsOf(nodes, origins, "x").map((m) => m.id)).toEqual(["x"]);
  });
});

describe("branch count by distinct span (fix/branch-count)", () => {
  const o = (childId: string, sourceId: string, start: number, quote: string) => ({ childId, sourceId, start, end: start + quote.length, quote });
  const origins = [o("b1", "a", 0, "熵"), o("b2", "a", 0, "熵"), o("b3", "a", 0, "熵"), o("x", "a", 2, "熵"), o("y", "a", 0, "熵增"), o("z", "other", 0, "熵")];
  it("re-asks of one span count once; different start / end / quote / source are separate", () => {
    expect(branchesFrom(origins, "a")).toHaveLength(3);
    expect(branchesFrom(origins, "a")[0].origins.map((x) => x.childId)).toEqual(["b1", "b2", "b3"]);
    expect(branchCounts(origins).get("a")).toBe(3);
    expect(branchCounts(origins).get("other")).toBe(1);
  });
  it("siblingsOf and the count share one grouping (groupBySpan)", () => {
    const n = (id: string, parentId: string | null, t: string) => ({ id, parentId, createdAt: t });
    const nodes = [n("a", null, "0"), n("b1", "a", "1"), n("b2", "a", "2"), n("b3", "a", "3"), n("x", "a", "4"), n("y", "a", "5")];
    for (const g of groupBySpan(origins.filter((x) => x.sourceId === "a"))) {
      for (const m of g.origins) expect(siblingsOf(nodes, origins, m.childId).map((s) => s.id)).toEqual(g.origins.map((x) => x.childId));
    }
  });
});

describe("sourceSpanOf: rendered selection → markdown source", () => {
  const src = "结论：**收入增长**主要来自 `海外` 市场。\n\n- 第一点\n- 第二点";
  const rendered = "结论：收入增长主要来自 海外 市场。\n第一点\n第二点";
  const sel = (t: string) => {
    const i = rendered.indexOf(t);
    return sourceSpanOf(src, rendered, i, i + t.length);
  };

  it("maps text inside bold to the source chars (no ** in the quote)", () => {
    expect(sel("收入增长")).toEqual({ start: src.indexOf("收入增长"), end: src.indexOf("收入增长") + 4, quote: "收入增长" });
  });

  it("a selection across formatting keeps the source markup and passes spanMatches", () => {
    const s = sel("收入增长主要来自 海外")!;
    expect(s.quote).toBe("收入增长**主要来自 `海外");
    expect(spanMatches(src, s.start, s.end, s.quote)).toBe(true);
  });

  it("picks the selected occurrence, not the first one", () => {
    const s2 = "**甲** 甲";
    const r2 = "甲 甲";
    expect(sourceSpanOf(s2, r2, 2, 3)).toEqual({ start: 6, end: 7, quote: "甲" });
    expect(sourceSpanOf(s2, r2, 0, 1)).toEqual({ start: 2, end: 3, quote: "甲" });
  });

  it("returns null when the rendered text does not align with the source", () => {
    expect(sourceSpanOf("abc", "xyz", 0, 3)).toBeNull();
  });
});
