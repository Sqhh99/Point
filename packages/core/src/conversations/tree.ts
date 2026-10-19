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

/** One forked span: every branch question asked from it (the first ask plus its re-asks). */
export interface SpanGroup {
  sourceId: string;
  start: number;
  end: number;
  quote: string;
  /** Origins in this span, in input order. */
  origins: BranchOrigin[];
}

/**
 * The single definition of "same span": source answer + start + end + quote. Both `siblingsOf`
 * (which questions are alternatives) and the 「⑂ n 个分支」 count go through this grouping.
 * Groups are returned in order of first appearance.
 */
export function groupBySpan(origins: readonly BranchOrigin[]): SpanGroup[] {
  const groups = new Map<string, SpanGroup>();
  for (const o of origins) {
    const key = JSON.stringify([o.sourceId, o.start, o.end, o.quote]);
    const g = groups.get(key);
    if (g) g.origins.push(o);
    else groups.set(key, { sourceId: o.sourceId, start: o.start, end: o.end, quote: o.quote, origins: [o] });
  }
  return [...groups.values()];
}

/** Number of distinct forked spans per message (re-asks of one span count once). */
export function branchCounts(origins: readonly BranchOrigin[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of groupBySpan(origins)) m.set(g.sourceId, (m.get(g.sourceId) ?? 0) + 1);
  return m;
}

/** True when [start, end) is a valid, non-empty span of `text` that equals `quote`. */
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
/** True when offset i sits between the two halves of a surrogate pair. */
const splitsPair = (text: string, i: number) => i > 0 && i < text.length && isHigh(text.charCodeAt(i - 1)) && isLow(text.charCodeAt(i));

export function spanMatches(text: string, start: number, end: number, quote: string): boolean {
  return !splitsPair(text, start) && !splitsPair(text, end) && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= text.length && text.slice(start, end) === quote;
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

/** Children of `parentId` ("" for roots) that are not span branches: the alternatives shown by 「‹ 2/3 ›」. */
function plainChildren<T extends TreeNode>(kids: Map<string, T[]>, branched: Set<string>, parentId: string): T[] {
  return (kids.get(parentId) ?? []).filter((n) => !branched.has(n.id));
}

/**
 * Alternatives at the position of `id`, oldest first: messages with the same parent that are not
 * span branches (regenerated answers, re-asked questions). A span-branch question's alternatives are
 * the other questions branched from the identical span (source, start, end, quote). Unknown id gives [].
 */
export function siblingsOf<T extends TreeNode>(nodes: readonly T[], origins: readonly BranchOrigin[], id: string): T[] {
  const node = nodes.find((n) => n.id === id);
  if (!node) return [];
  const branched = new Set(origins.map((o) => o.childId));
  const group = groupBySpan(origins).find((g) => g.origins.some((o) => o.childId === id));
  if (group) {
    // Span-branch questions are alternatives of each other when they fork from the very same span.
    const same = new Set(group.origins.map((o) => o.childId));
    return nodes.filter((n) => same.has(n.id)).sort(order);
  }
  const ids = new Set(nodes.map((n) => n.id));
  const key = node.parentId && ids.has(node.parentId) ? node.parentId : "";
  return plainChildren(childrenOf(nodes), branched, key);
}

/** Leaf reached from `fromId` by always taking the newest non-branch child (design: newest answer shows by default). */
export function latestLeaf<T extends TreeNode>(nodes: readonly T[], origins: readonly BranchOrigin[], fromId: string): T | undefined {
  const kids = childrenOf(nodes);
  const branched = new Set(origins.map((o) => o.childId));
  let cur = nodes.find((n) => n.id === fromId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const next: T | undefined = plainChildren(kids, branched, cur.id).at(-1);
    if (!next) break;
    cur = next;
  }
  return cur;
}

/** What a conversation opens on: newest root, then newest answers all the way down. */
export function defaultLeaf<T extends TreeNode>(nodes: readonly T[], origins: readonly BranchOrigin[]): T | undefined {
  const root = plainChildren(childrenOf(nodes), new Set(origins.map((o) => o.childId)), "").at(-1);
  return root ? latestLeaf(nodes, origins, root.id) : undefined;
}

/**
 * Distinct forked spans of answer `id`, for the 「⑂ n 个分支」 chip of the answer being shown:
 * `length` is the count; re-asks of one span are one entry (grouped by `groupBySpan`).
 */
export function branchesFrom(origins: readonly BranchOrigin[], id: string): SpanGroup[] {
  return groupBySpan(origins.filter((o) => o.sourceId === id));
}
