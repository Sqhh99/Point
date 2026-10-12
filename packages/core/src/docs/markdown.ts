import type { List, ListItem, Root, RootContent, Table } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { buildDoc } from "./build.js";
import type { BlockInput, ParsedDoc } from "./types.js";

type Node = { type: string; value?: string; alt?: string | null; children?: Node[] };

function text(node: Node): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  if (node.type === "break") return "\n";
  if (node.type === "image") return node.alt ?? "";
  return (node.children ?? []).map(text).join("");
}

function listItems(list: List): string[] {
  return list.children.map((item: ListItem) => item.children.map((c) => text(c as Node)).join("\n").trim());
}

function tableRows(table: Table): string[][] {
  return table.children.map((row) => row.children.map((cell) => text(cell as Node).trim()));
}

function toBlocks(nodes: RootContent[], out: BlockInput[]): void {
  for (const node of nodes) {
    switch (node.type) {
      case "heading":
        out.push({ type: "heading", level: node.depth, text: text(node as Node).trim() });
        break;
      case "paragraph": {
        const only = node.children.length === 1 ? node.children[0] : undefined;
        if (only?.type === "image") out.push({ type: "image", alt: only.alt ?? "" });
        else out.push({ type: "paragraph", text: text(node as Node).trim() });
        break;
      }
      case "list":
        out.push({ type: "list", ordered: !!node.ordered, items: listItems(node) });
        break;
      case "code":
        out.push({ type: "code", lang: node.lang ?? undefined, text: node.value });
        break;
      case "table":
        out.push({ type: "table", rows: tableRows(node) });
        break;
      case "blockquote":
        toBlocks(node.children, out);
        break;
      case "html":
        if (node.value.trim()) out.push({ type: "paragraph", text: node.value.trim() });
        break;
      default:
        break;
    }
  }
}

export function parseMarkdown(source: string, fallbackTitle = "未命名"): ParsedDoc {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(source) as Root;
  const out: BlockInput[] = [];
  toBlocks(tree.children, out);
  return buildDoc("md", out, fallbackTitle);
}
