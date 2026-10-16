import { useState } from "react";

/** Explicit empty state for a document that cannot be shown; the OS app opens the stored copy (main resolves the path). */
export function DocError({ docId, message }: { docId: string; message: string }) {
  const [state, setState] = useState<"idle" | "opening" | "error">("idle");
  const [detail, setDetail] = useState("");
  const open = () => {
    setState("opening");
    window.point.docs.openExternal(docId).then(
      () => setState("idle"),
      (e: Error) => {
        setDetail(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
        setState("error");
      }
    );
  };
  return (
    <div className="doc-error" data-testid="doc-error" role="alert">
      <h2>无法在 Point 里显示这份文档</h2>
      <p className="muted" data-testid="doc-error-message">
        {message}
      </p>
      <div className="empty-actions">
        <button className="primary" onClick={open} disabled={state === "opening"} data-testid="open-external">
          {state === "opening" ? "正在打开…" : "用系统应用打开"}
        </button>
      </div>
      {state === "error" && <p className="doc-error-detail">{detail}</p>}
    </div>
  );
}
