import { useEffect, useState } from "react";
import type { Block, ParsedDoc } from "@point/core";

function BlockView({ b }: { b: Block }) {
  const common = { "data-block-id": b.id, "data-page": b.page };
  switch (b.type) {
    case "heading": {
      const H = `h${Math.min(Math.max(b.level, 1), 6)}` as "h1";
      return <H {...common}>{b.text}</H>;
    }
    case "paragraph":
      return <p {...common}>{b.text}</p>;
    case "list": {
      const L = b.ordered ? "ol" : "ul";
      return (
        <L {...common}>
          {b.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </L>
      );
    }
    case "code":
      return (
        <pre {...common}>
          <code>{b.text}</code>
        </pre>
      );
    case "table":
      return (
        <table {...common}>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "image":
      return (
        <figure className="image-placeholder" {...common}>
          图片{b.alt ? `：${b.alt}` : ""}
        </figure>
      );
  }
}

export function Reader({ docId, hasWorkspace }: { docId: string | null; hasWorkspace: boolean }) {
  const [doc, setDoc] = useState<ParsedDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDoc(null);
    setError(null);
    if (!docId) return;
    let live = true;
    window.point.docs
      .get(docId)
      .then((d) => live && setDoc(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [docId]);

  if (!docId) return <div className="placeholder">{hasWorkspace ? "从左侧导入或选择一篇文档开始阅读" : "先在左上角选择一个工作区文件夹"}</div>;
  if (error) return <div className="placeholder">无法打开文档：{error}</div>;
  if (!doc) return <div className="placeholder">正在解析…</div>;

  let lastPage: number | undefined;
  return (
    <article className="reader" data-testid="reader">
      {doc.blocks.map((b) => {
        const marker = b.page !== undefined && b.page !== lastPage ? b.page : undefined;
        lastPage = b.page ?? lastPage;
        return (
          <div key={b.id} className="block">
            {marker !== undefined && marker > 1 && <div className="page-marker">第 {marker} 页</div>}
            <BlockView b={b} />
          </div>
        );
      })}
      {doc.blocks.length === 0 && <div className="placeholder">这篇文档没有可提取的文字</div>}
    </article>
  );
}
