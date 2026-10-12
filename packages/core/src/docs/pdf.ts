import { buildDoc } from "./build.js";
import type { BlockInput, ParsedDoc } from "./types.js";

interface TextItem {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
}

/** Extracts text per page; consecutive lines are grouped into paragraphs at blank-line/vertical gaps. */
export async function parsePdf(data: Uint8Array, fallbackTitle = "未命名"): Promise<ParsedDoc> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Register the worker in-process so pdfjs never dynamic-imports a worker file by path
  // (that path would not exist once the app is bundled).
  const g = globalThis as { pdfjsWorker?: unknown };
  g.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0
  }).promise;
  const out: BlockInput[] = [];
  try {
    for (let page = 1; page <= doc.numPages; page++) {
      const p = await doc.getPage(page);
      const content = await p.getTextContent();
      const lines: string[] = [];
      let line = "";
      let lastY: number | undefined;
      let paraBreak = false;
      const paras: string[] = [];
      const flushPara = () => {
        const t = lines.join(" ").replace(/\s+/g, " ").trim();
        if (t) paras.push(t);
        lines.length = 0;
      };
      for (const item of content.items as TextItem[]) {
        if (typeof item.str !== "string") continue;
        const y = item.transform?.[5];
        if (lastY !== undefined && y !== undefined && Math.abs(lastY - y) > 1) {
          lines.push(line);
          line = "";
          if (Math.abs(lastY - y) > 24) paraBreak = true;
        }
        if (paraBreak) {
          flushPara();
          paraBreak = false;
        }
        line += item.str;
        if (y !== undefined) lastY = y;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        }
      }
      lines.push(line);
      flushPara();
      for (const t of paras) out.push({ type: "paragraph", text: t, page });
      p.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return buildDoc("pdf", out, fallbackTitle);
}
