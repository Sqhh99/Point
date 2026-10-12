import DOMPurify from "dompurify";
import { Marked } from "marked";
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

/** Wraps a mermaid <pre> in a card with a 图/源码 toggle (top-right). Built with DOM APIs, no HTML strings. */
function mermaidCard(pre: HTMLPreElement) {
  const card = document.createElement("figure");
  card.className = "mermaid-card";
  const bar = document.createElement("div");
  bar.className = "mermaid-toggle";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "图表显示方式");
  const mk = (label: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    bar.append(b);
    return b;
  };
  const btnDiagram = mk("图");
  const btnSource = mk("源码");
  const diagram = document.createElement("div");
  diagram.className = "mermaid-figure";
  const note = document.createElement("div");
  note.className = "mermaid-failed";
  pre.replaceWith(card);
  card.append(bar, diagram, pre);
  const show = (which: "diagram" | "source") => {
    diagram.hidden = which !== "diagram";
    pre.hidden = which !== "source";
    btnDiagram.setAttribute("aria-pressed", String(which === "diagram"));
    btnSource.setAttribute("aria-pressed", String(which === "source"));
  };
  btnDiagram.onclick = () => show("diagram");
  btnSource.onclick = () => show("source");
  show("source");
  return {
    diagram,
    show,
    fail(reason: string) {
      bar.remove();
      note.textContent = "无法渲染";
      note.title = reason;
      card.classList.add("failed");
      card.append(note);
      show("source");
    }
  };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** AI output is untrusted: raw HTML (block or inline) is shown as text, never parsed. */
const md = new Marked({
  async: false,
  gfm: true,
  breaks: false,
  renderer: {
    html: ({ text }) => escapeHtml(text)
  }
});

/** Renders untrusted markdown: marked → DOMPurify; mermaid fences become SVG once `streaming` is false. */
export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => DOMPurify.sanitize(md.parse(text) as string, { FORBID_TAGS: ["img", "style", "iframe", "form"], FORBID_ATTR: ["style"] }), [text]);

  useEffect(() => {
    const root = ref.current;
    if (streaming || !root) return;
    const blocks = Array.from(root.querySelectorAll<HTMLElement>("pre > code.language-mermaid"));
    if (blocks.length === 0) return;
    let live = true;
    void loadMermaid().then(async (mermaid) => {
      for (const code of blocks) {
        const pre = code.parentElement as HTMLPreElement;
        const source = code.textContent ?? "";
        const card = mermaidCard(pre);
        try {
          const { svg } = await mermaid.render(`mmd-${++seq}`, source);
          if (!live) return;
          // mermaid sanitizes labels itself under securityLevel "strict"; sanitize the SVG once more.
          card.diagram.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ["foreignObject", "style"] });
          card.show("diagram");
        } catch (err) {
          if (!live) return;
          card.fail((err as Error).message);
        }
      }
    });
    return () => {
      live = false;
    };
  }, [html, streaming]);

  return <div ref={ref} className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
