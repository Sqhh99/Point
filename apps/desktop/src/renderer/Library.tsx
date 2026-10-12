import type { DocMeta } from "../shared/ipc";

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
