import JSZip from "jszip";

/** Minimal valid PDF with one text line per entry in `pages` (ASCII only), 12pt lines 40pt apart, in one standard Type1 font by name (not embedded; Helvetica by default). */
export function makePdf(pages: string[][], font = "Helvetica"): Uint8Array {
  const objs: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objs[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /${font} >>`;
  pages.forEach((lines, i) => {
    const id = pageIds[i];
    let y = 760;
    const ops = lines
      .map((l) => {
        const s = `BT /F1 12 Tf 72 ${y} Td (${l.replace(/[()\\]/g, "\\$&")}) Tj ET`;
        y -= l === "" ? 0 : 40;
        return l === "" ? "" : s;
      })
      .filter(Boolean)
      .join("\n");
    objs[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`;
    objs[id + 1] = `<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Minimal DOCX: paragraphs with optional built-in heading style. */
export async function makeDocx(paras: { style?: "Heading1" | "Heading2"; text: string; color?: string }[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:styles>`);
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  );
  const body = paras
    .map((p) => `<w:p>${p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : ""}<w:r>${p.color ? `<w:rPr><w:color w:val="${p.color}"/></w:rPr>` : ""}<w:t xml:space="preserve">${esc(p.text)}</w:t></w:r></w:p>`)
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  );
  return zip.generateAsync({ type: "uint8array" });
}

/** A real .xlsx: one entry per sheet (name + rows); the first sheet merges its first row across the columns. */
export async function makeXlsx(sheets: { name: string; rows: (string | number)[][] }[]): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  sheets.forEach((s, i) => {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    ws["!cols"] = s.rows[0]?.map(() => ({ wch: 14 }));
    if (i === 0 && (s.rows[0]?.length ?? 0) > 1) ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: s.rows[0]!.length - 1 } }];
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  });
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}
