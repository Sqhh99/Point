import { describe, expect, it } from "vitest";
import { branchCounts, branchTree, breadcrumb, locateOrigin, mainLeaf, pathTo, spanMatches, type BranchOrigin, type TreeNode } from "../src/index.js";

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
