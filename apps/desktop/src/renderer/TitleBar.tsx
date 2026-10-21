import { useEffect, useState } from "react";

const api = window.point;

interface Props {
  workspace: string | null;
  fileName: string | null;
  onOpenWorkspace(): void;
  onOpenFile(): void;
  onImport(): void;
}

export function TitleBar(p: Props) {
  const isMac = api.platform === "darwin";
  const [maximized, setMaximized] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => api.window.onMaximized(setMaximized), []);
  const folder = p.workspace?.split(/[\\/]/).filter(Boolean).pop();

  return (
    <header className={`titlebar${isMac ? " mac" : ""}`} data-testid="titlebar" onDoubleClick={isMac ? undefined : () => void api.window.action("toggleMaximize")}>
      <div className="titlebar-left">
        <span className="titlebar-workspace" title={p.workspace ?? undefined}>{folder ?? "Point"}</span>
        <div className="titlebar-menu no-drag">
          {/* Narrow title bar: the label collapses (CSS container query), the folder icon and ▾ stay;
              the tooltip and aria-label keep the full label. */}
          <button className="titlebar-open" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu" aria-label="打开" title="打开">
            <svg className="titlebar-open-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
              <path d="M1.5 3.5h4l1.5 1.5h7.5v8h-13z" />
            </svg>
            <span className="titlebar-open-label">打开</span>
            <span className="titlebar-open-caret" aria-hidden="true">▾</span>
          </button>
          {menu && (
            <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
              <button role="menuitem" onClick={() => { setMenu(false); p.onOpenWorkspace(); }}>工作区…</button>
              <button role="menuitem" onClick={() => { setMenu(false); p.onOpenFile(); }}>单个文件…</button>
              <button role="menuitem" disabled={!p.workspace} onClick={() => { setMenu(false); p.onImport(); }}>导入到工作区…</button>
            </div>
          )}
        </div>
      </div>
      <div className="titlebar-title">{p.fileName ?? ""}</div>
      <div className="titlebar-right">
        {!isMac && (
          <div className="window-controls no-drag">
            <button aria-label="最小化" onClick={() => void api.window.action("minimize")}>
              <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" /></svg>
            </button>
            <button aria-label={maximized ? "还原" : "最大化"} onClick={() => void api.window.action("toggleMaximize")}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
                {maximized ? <path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" /> : <rect x=".5" y=".5" width="9" height="9" />}
              </svg>
            </button>
            <button className="close" aria-label="关闭" onClick={() => void api.window.action("close")}>
              <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" /></svg>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
