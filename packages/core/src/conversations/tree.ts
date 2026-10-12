/** Pure helpers over a conversation's message tree. Offsets are UTF-16 indices, [start, end). */

export interface TreeNode {
  id: string;
  parentId: string | null;
  createdAt: string;
}

export interface BranchOrigin {
  childId: string;
  sourceId: string;
  start: number;
  end: number;
  quote: string;
}

const order = (a: TreeNode, b: TreeNode) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Children per parent id ("" for roots), oldest first. Nodes whose parent is missing count as roots. */
export function childrenOf<T extends TreeNode>(nodes: readonly T[]): Map<string, T[]> {
  const ids = new Set(nodes.map((n) => n.id));
  const map = new Map<string, T[]>();
  for (const n of [...nodes].sort(order)) {
    const key = n.parentId && ids.has(n.parentId) ? n.parentId : "";
    map.set(key, [...(map.get(key) ?? []), n]);
  }
  return map;
}

/** Root → leaf path. Unknown leaf gives []. A cycle (corrupt data) is cut where it repeats. */
export function pathTo<T extends TreeNode>(nodes: readonly T[], leafId: string): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const path: T[] = [];
  const seen = new Set<string>();
  for (let n = byId.get(leafId); n && !seen.has(n.id); n = n.parentId ? byId.get(n.parentId) : undefined) {
    seen.add(n.id);
    path.push(n);
  }
  return path.reverse();
}

/**
 * Leaf of the main thread below `fromId` (or the first root): follow the first child that is
 * not a branch. This is where a plain "send" appends.
 */
export function mainLeaf<T extends TreeNode>(nodes: readonly T[], origins: readonly BranchOrigin[], fromId?: string): T | undefined {
  const kids = childrenOf(nodes);
  const branched = new Set(origins.map((o) => o.childId));
  let cur = fromId ? nodes.find((n) => n.id === fromId) : kids.get("")?.find((n) => !branched.has(n.id));
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const next: T | undefined = kids.get(cur.id)?.find((n) => !branched.has(n.id));
    if (!next) break;
    cur = next;
  }
  return cur;
}

export interface Crumb {
  /** First message of this level (undefined for the main thread). */
  branchId?: string;
  quote?: string;
}

/** Breadcrumb for a leaf: the main thread, then one crumb per branch entered along the path. */
export function breadcrumb<T extends TreeNode>(nodes: readonly T[], origins: readonly BranchOrigin[], leafId: string): Crumb[] {
  const byChild = new Map(origins.map((o) => [o.childId, o]));
  const crumbs: Crumb[] = [{}];
  for (const n of pathTo(nodes, leafId)) {
    const o = byChild.get(n.id);
    if (o) crumbs.push({ branchId: n.id, quote: o.quote });
  }
  return crumbs;
}

export interface BranchTreeNode {
  branchId: string;
  quote: string;
  sourceId: string;
  children: BranchTreeNode[];
}

/** Branches as a tree: a branch's parent is the nearest branch that contains its source message. */
export function branchTree<T extends TreeNode>(nodes: readonly T[], origins: readonly BranchOrigin[]): BranchTreeNode[] {
  const ids = new Set(nodes.map((n) => n.id));
  const byChild = new Map(origins.map((o) => [o.childId, o]));
  const items = new Map<string, BranchTreeNode>();
  for (const o of origins) {
    if (ids.has(o.childId) && ids.has(o.sourceId)) items.set(o.childId, { branchId: o.childId, quote: o.quote, sourceId: o.sourceId, children: [] });
  }
  const roots: BranchTreeNode[] = [];
  const created = new Map(nodes.map((n) => [n.id, n.createdAt]));
  const sorted = [...items.values()].sort((a, b) => ((created.get(a.branchId) ?? "") < (created.get(b.branchId) ?? "") ? -1 : 1));
  for (const item of sorted) {
    const owner = [...pathTo(nodes, item.sourceId)].reverse().find((n) => byChild.has(n.id) && items.has(n.id));
    (owner ? items.get(owner.id)!.children : roots).push(item);
  }
  return roots;
}

/** Number of branches forked from each message. */
export function branchCounts(origins: readonly BranchOrigin[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of origins) m.set(o.sourceId, (m.get(o.sourceId) ?? 0) + 1);
  return m;
}

/** True when [start, end) is a valid, non-empty span of `text` that equals `quote`. */
export function spanMatches(text: string, start: number, end: number, quote: string): boolean {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= text.length && text.slice(start, end) === quote;
}

/** Where the quoted span is now: the stored offsets if they still match, else the occurrence of `quote` nearest to them. */
export function locateOrigin(text: string, o: Pick<BranchOrigin, "start" | "end" | "quote">): { start: number; end: number } | null {
  if (spanMatches(text, o.start, o.end, o.quote)) return { start: o.start, end: o.end };
  if (!o.quote) return null;
  let best = -1;
  for (let i = text.indexOf(o.quote); i !== -1; i = text.indexOf(o.quote, i + 1)) {
    if (best === -1 || Math.abs(i - o.start) < Math.abs(best - o.start)) best = i;
  }
  return best === -1 ? null : { start: best, end: best + o.quote.length };
}
