import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef } from "react";

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  mermaidReady ??= import("mermaid").then(({ default: m }) => {
    m.initialize({ startOnLoad: false, securityLevel: "strict", theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default" });
    return m;
  });
  return mermaidReady;
}

let seq = 0;

/** Renders untrusted markdown: marked → DOMPurify; mermaid fences become SVG once `streaming` is false. */
export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true, breaks: false })), [text]);

  useEffect(() => {
    const root = ref.current;
    if (streaming || !root) return;
    const blocks = Array.from(root.querySelectorAll<HTMLElement>("pre > code.language-mermaid"));
    if (blocks.length === 0) return;
    let live = true;
    void loadMermaid().then(async (mermaid) => {
      for (const code of blocks) {
        const pre = code.parentElement!;
        try {
          const { svg } = await mermaid.render(`mmd-${++seq}`, code.textContent ?? "");
          if (!live) return;
          const fig = document.createElement("figure");
          fig.className = "mermaid-figure";
          // mermaid sanitizes labels itself under securityLevel "strict"; sanitize the SVG once more.
          fig.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ["foreignObject", "style"] });
          pre.replaceWith(fig);
        } catch (err) {
          if (!live) return;
          pre.classList.add("mermaid-error");
          pre.title = `图表无法渲染：${(err as Error).message}`;
        }
      }
    });
    return () => {
      live = false;
    };
  }, [html, streaming]);

  return <div ref={ref} className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
