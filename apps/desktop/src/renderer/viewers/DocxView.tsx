import DOMPurify from "dompurify";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { DocxImage } from "@point/core";

const TAGS = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "strong", "b", "em", "i", "u", "s", "sub", "sup", "br", "hr", "table", "thead", "tbody", "tr", "th", "td", "blockquote", "pre", "code", "span"];

/** Second sanitizing pass in the renderer (main already allowlisted): tags only, no attributes but the image slot and cell spans. */
export const cleanHtml = (html: string): string => {
  // The only style allowed is the colour main wrote: exactly `color:#RRGGBB`.
  DOMPurify.addHook("uponSanitizeAttribute", (_node, d) => {
    if (d.attrName === "style" && !/^color:#[0-9A-Fa-f]{6}$/.test(d.attrValue)) d.keepAttr = false;
  });
  try {
    return DOMPurify.sanitize(html, { ALLOWED_TAGS: TAGS, ALLOWED_ATTR: ["colspan", "rowspan", "data-docx-img", "style"], ALLOW_DATA_ATTR: false, KEEP_CONTENT: true });
  } finally {
    DOMPurify.removeHook("uponSanitizeAttribute");
  }
};

const bytes = (b64: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/**
 * Word document as sanitized HTML. Images are decoded with createImageBitmap and painted on a canvas,
 * so the page's CSP (img-src 'self' point-capture:) stays exactly as it is: no data:/blob: image URLs.
 */
export function DocxView({ html, images, zoom, markedIds }: { html: string; images: DocxImage[]; zoom: number; markedIds: Set<string> }) {
  const ref = useRef<HTMLDivElement>(null);
  const safe = useMemo(() => cleanHtml(html), [html]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    Array.from(root.children).forEach((el, i) => {
      el.classList.add("block");
      el.setAttribute("data-block-id", `d${i}`);
    });
  }, [safe]);

  useEffect(() => {
    ref.current?.querySelectorAll(":scope > .block").forEach((el) => el.classList.toggle("marked", markedIds.has(el.getAttribute("data-block-id") ?? "")));
  }, [markedIds, safe]);

  useEffect(() => {
    let live = true;
    ref.current?.querySelectorAll<HTMLElement>("[data-docx-img]").forEach((slot) => {
      const img = images[Number(slot.getAttribute("data-docx-img"))];
      if (!img || slot.firstChild) return;
      createImageBitmap(new Blob([bytes(img.base64)], { type: img.mime })).then(
        (bmp) => {
          if (!live) return bmp.close();
          const canvas = document.createElement("canvas");
          canvas.width = bmp.width;
          canvas.height = bmp.height;
          canvas.className = "docx-img";
          canvas.getContext("2d")?.drawImage(bmp, 0, 0);
          bmp.close();
          slot.replaceChildren(canvas);
        },
        () => live && (slot.textContent = "[图片无法显示]")
      );
    });
    return () => {
      live = false;
    };
  }, [safe, images]);

  return <div className="docx-body" ref={ref} style={{ zoom: zoom / 100 }} data-testid="docx-body" dangerouslySetInnerHTML={{ __html: safe }} />;
}
