import type { Mark } from "@point/core";
import type { DocMeta } from "../shared/ipc";
import { captureUrl } from "./AIPanel";

const TYPE_LABEL: Record<DocMeta["type"], string> = { pdf: "PDF", docx: "Word", md: "MD", xlsx: "Excel" };

interface Props {
  open: boolean;
  onToggle(): void;
  workspace: string | null;
  docs: DocMeta[];
  activeId: string | null;
  onSelect(id: string): void;
  onChooseWorkspace(): void;
  onImport(): void;
  onOpenFile(): void;
  onOpenSettings(): void;
  settingsActive: boolean;
  /** Marks of the open document. */
  marks: Mark[];
  /** Checked mark ids, in the order they were checked. */
  checked: string[];
  onToggleMark(id: string): void;
  onLocateMark(m: Mark): void;
  onRemoveMark(id: string): void;
  onBatchAsk(): void;
}

function MarksGroup(p: Props) {
  return (
    <section className="library-group" aria-label="标记" data-testid="marks">
      <h2 className="group-title">标记</h2>
      {p.marks.length === 0 ? (
        <div className="empty">选中文字或框选后点「标记」</div>
      ) : (
        <ul className="mark-list">
          {p.marks.map((m) => {
            const on = p.checked.includes(m.id);
            return (
              <li key={m.id} className="mark-item" data-testid="mark-item">
                <input type="checkbox" checked={on} onChange={() => p.onToggleMark(m.id)} aria-label="勾选标记" />
                <button className="mark-body" onClick={() => p.onLocateMark(m)} title="跳回原文">
                  {m.anchor.kind === "text" ? <span className="mark-text">{m.anchor.text}</span> : <img className="mark-thumb" src={captureUrl(m.anchor.sha)} alt="截图标记" />}
                  {m.anchor.page && <span className="mark-page">{m.anchor.page}</span>}
                </button>
                <button className="icon mark-remove" onClick={() => p.onRemoveMark(m.id)} aria-label="删除标记">
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mark-actions">
        <button className="primary" data-testid="batch-ask" disabled={p.checked.length === 0} onClick={p.onBatchAsk}>
          一起问（{p.checked.length}）
        </button>
      </div>
    </section>
  );
}

export function Library(p: Props) {
  const folder = p.workspace?.split(/[\\/]/).filter(Boolean).pop();
  return (
    <aside className="library" aria-label="文档库">
      <div className="library-head">
        <button className="icon" onClick={p.onToggle} title={p.open ? "收起文档库" : "展开文档库"} aria-expanded={p.open}>
          {p.open ? "‹" : "›"}
        </button>
        {p.open && (
          <button className="workspace-name" onClick={p.onChooseWorkspace} title={p.workspace ?? "选择工作区"}>
            {folder ?? "选择工作区…"}
          </button>
        )}
      </div>
      {p.open && (
        <>
          <div className="library-actions">
            {p.workspace ? (
              <button onClick={p.onImport}>导入文档</button>
            ) : (
              <>
                <button onClick={p.onChooseWorkspace}>打开工作区</button>
                <button onClick={p.onOpenFile}>打开文件</button>
              </>
            )}
          </div>
          <ul className="doc-list" data-testid="doc-list">
            {p.docs.map((d) => (
              <li key={d.id}>
                <button className={d.id === p.activeId ? "doc active" : "doc"} onClick={() => p.onSelect(d.id)} title={d.title}>
                  <span className="doc-type">{TYPE_LABEL[d.type]}</span>
                  <span className="doc-title">{d.title}</span>
                </button>
              </li>
            ))}
            {p.workspace && p.docs.length === 0 && <li className="empty">还没有文档</li>}
          </ul>
          {p.workspace && p.activeId && <MarksGroup {...p} />}
          <div className="library-foot">
            <button className={p.settingsActive ? "link active" : "link"} onClick={p.onOpenSettings}>
              设置
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
