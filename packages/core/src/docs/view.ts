import JSZip from "jszip";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { XLSX_MAX_ROWS, readWorkbook } from "./xlsx.js";

/** What the reader shows for a document: the original look, not the extracted text blocks. */
export type DocView =
  | { kind: "pdf"; data: Uint8Array }
  | { kind: "docx"; html: string; images: DocxImage[] }
  | { kind: "xlsx"; sheets: SheetView[] }
  | { kind: "md" };

/** An image from a .docx, handed to the renderer as bytes; it is decoded with createImageBitmap, never via <img src>. */
export interface DocxImage {
  mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  base64: string;
}

export interface SheetCell {
  /** Formatted text, as Excel shows it. */
  v: string;
  /** Number-like cell: right aligned. */
  n?: boolean;
  /** Merge spans (top-left cell of a merge only). */
  rs?: number;
  cs?: number;
  /** Covered by a merge: not rendered. */
  x?: boolean;
}

export interface SheetView {
  name: string;
  rows: SheetCell[][];
  /** Column widths in characters (Excel `wch`), same length as a row. */
  widths: number[];
  /** Rows in the source; larger than rows.length when cut. */
  totalRows: number;
  totalCols: number;
}

export const XLSX_MAX_COLS = 100;
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_IMAGES = 200;
const MAX_IMAGE_BYTES = 8_000_000;

const ALLOWED = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "strong", "b", "em", "i", "u", "s", "sub", "sup", "br", "hr", "table", "thead", "tbody", "tr", "th", "td", "blockquote", "pre", "code", "span"]);
const VOID = new Set(["br", "hr"]);
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z][a-zA-Z0-9:-]*(?:\s*=\s*"[^"]*")?)*)\s*(\/?)>|[<>]/g;
const ATTR = /([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*"([^"]*)"/g;

/**
 * Allowlist sanitizer for mammoth's HTML. Output has tags from ALLOWED only and NO attributes, except
 * numeric colspan/rowspan on cells and `data-docx-img="N"` placeholders for images (the renderer fills
 * those with decoded canvases). Links lose their href (text stays), scripts/styles/iframes are removed
 * with their content, and any stray `<` or `>` is escaped. Nothing in the result can load or run anything.
 */
export function sanitizeDocxHtml(html: string): string {
  const src = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|noscript|template|svg|math|link|meta|base|form)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed|noscript|template|svg|math)\b[\s\S]*$/gi, "");
  let out = "";
  let last = 0;
  for (const m of src.matchAll(TAG)) {
    out += src.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[0] === "<") {
      out += "&lt;";
      continue;
    }
    if (m[0] === ">") {
      out += "&gt;";
      continue;
    }
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (closing) {
      if (ALLOWED.has(name) && !VOID.has(name)) out += `</${name}>`;
      continue;
    }
    const attrs = new Map<string, string>();
    for (const a of m[3].matchAll(ATTR)) if (!attrs.has(a[1].toLowerCase())) attrs.set(a[1].toLowerCase(), a[2]);
    if (name === "img") {
      const id = /^point-img:(\d{1,4})$/.exec(attrs.get("src") ?? "")?.[1];
      out += id !== undefined ? `<span data-docx-img="${Number(id)}"></span>` : "[图片]";
    } else if (ALLOWED.has(name)) {
      let extra = "";
      // Run colour (see tagColors): only a validated #RRGGBB survives, written as the sole style property.
      const col = name === "span" ? /^ptc-([0-9A-F]{6})$/.exec(attrs.get("class") ?? "")?.[1] : undefined;
      if (col) extra += ` style="color:#${col}"`;
      if (name === "td" || name === "th") {
        for (const k of ["colspan", "rowspan"]) {
          const v = attrs.get(k);
          if (v && /^\d{1,3}$/.test(v) && Number(v) >= 1) extra += ` ${k}="${Number(v)}"`;
        }
      }
      out += `<${name}${extra}>`;
    }
  }
  return out + src.slice(last).replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;"));
}

/**
 * mammoth drops run colours. Before converting, each `<w:color w:val="RRGGBB"/>` becomes a character style
 * `ptc-RRGGBB` (declared in styles.xml) that the style map turns into `span.ptc-RRGGBB`; the sanitizer then
 * emits `style="color:#RRGGBB"` for exactly that class. Any failure just means "no colours".
 */
async function tagColors(data: Uint8Array): Promise<{ data: Uint8Array; colors: string[] }> {
  try {
    const zip = await JSZip.loadAsync(data);
    const doc = zip.file("word/document.xml");
    const styles = zip.file("word/styles.xml");
    if (!doc || !styles) return { data, colors: [] };
    const colors = new Set<string>();
    const xml = (await doc.async("string")).replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, (rpr) => {
      if (rpr.includes("<w:rStyle")) return rpr;
      return rpr.replace(/<w:color\b[^>]*?\bw:val="([0-9A-Fa-f]{6})"[^>]*?\/>/, (_m, hex: string) => {
        const c = hex.toUpperCase();
        if (colors.size >= 64 && !colors.has(c)) return "";
        colors.add(c);
        return `<w:rStyle w:val="ptc${c}"/>`;
      });
    });
    if (colors.size === 0) return { data, colors: [] };
    const defs = [...colors].map((c) => `<w:style w:type="character" w:styleId="ptc${c}"><w:name w:val="ptc-${c}"/></w:style>`).join("");
    const st = (await styles.async("string")).replace(/<\/w:styles>\s*$/, `${defs}</w:styles>`);
    zip.file("word/document.xml", xml);
    zip.file("word/styles.xml", st);
    return { data: await zip.generateAsync({ type: "uint8array" }), colors: [...colors] };
  } catch {
    return { data, colors: [] };
  }
}

/** DOCX → sanitized HTML (headings, lists, tables, bold/italic/underline) plus its images as bytes. */
export async function renderDocx(data: Uint8Array): Promise<{ html: string; images: DocxImage[] }> {
  const images: DocxImage[] = [];
  const convertImage = mammoth.images.imgElement(async (image) => {
    const mime = image.contentType;
    if (!IMAGE_MIME.has(mime) || images.length >= MAX_IMAGES) return { src: "" };
    const base64 = await image.read("base64");
    if (base64.length > MAX_IMAGE_BYTES * 1.4) return { src: "" };
    images.push({ mime: mime as DocxImage["mime"], base64 });
    return { src: `point-img:${images.length - 1}` };
  });
  const tagged = await tagColors(data);
  const styleMap = tagged.colors.map((c) => `r[style-name='ptc-${c}'] => span.ptc-${c}`);
  const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(tagged.data) }, { convertImage, styleMap });
  return { html: sanitizeDocxHtml(value), images };
}

/** Real grid per sheet: formatted text, merges, column widths; capped so a huge export cannot freeze the reader. */
export function renderSheets(data: Uint8Array): SheetView[] {
  const wb = readWorkbook(data);
  const out: SheetView[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws?.["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const totalRows = range.e.r + 1;
    const totalCols = range.e.c + 1;
    const nr = Math.min(totalRows, XLSX_MAX_ROWS);
    const nc = Math.min(totalCols, XLSX_MAX_COLS);
    const rows: SheetCell[][] = [];
    let any = false;
    for (let r = 0; r < nr; r++) {
      const row: SheetCell[] = [];
      for (let c = 0; c < nc; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
        const v = cell ? (cell.w ?? (cell.v === undefined || cell.v === null ? "" : String(cell.v))) : "";
        if (v !== "") any = true;
        row.push(cell?.t === "n" ? { v, n: true } : { v });
      }
      rows.push(row);
    }
    if (!any) continue;
    for (const mg of ws["!merges"] ?? []) {
      if (mg.s.r >= nr || mg.s.c >= nc) continue;
      const rs = Math.min(mg.e.r, nr - 1) - mg.s.r + 1;
      const cs = Math.min(mg.e.c, nc - 1) - mg.s.c + 1;
      for (let r = mg.s.r; r < mg.s.r + rs; r++) for (let c = mg.s.c; c < mg.s.c + cs; c++) if (r !== mg.s.r || c !== mg.s.c) rows[r][c] = { v: "", x: true };
      if (rs > 1) rows[mg.s.r][mg.s.c].rs = rs;
      if (cs > 1) rows[mg.s.r][mg.s.c].cs = cs;
    }
    const widths = Array.from({ length: nc }, (_, c) => {
      const w = ws["!cols"]?.[c]?.wch;
      return typeof w === "number" && w > 0 ? Math.min(Math.round(w), 80) : 10;
    });
    out.push({ name, rows, widths, totalRows, totalCols });
  }
  return out;
}

/** Builds the view for one document type; PDF bytes are rendered by the renderer's pdf.js. */
export async function buildDocView(type: "pdf" | "docx" | "md" | "xlsx", data: Uint8Array): Promise<DocView> {
  if (type === "pdf") return { kind: "pdf", data };
  if (type === "docx") return { kind: "docx", ...(await renderDocx(data)) };
  if (type === "xlsx") return { kind: "xlsx", sheets: renderSheets(data) };
  return { kind: "md" };
}
