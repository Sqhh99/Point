import { useEffect, useState } from "react";
import type { RecentItem } from "../shared/ipc";

const api = window.point;

interface Props {
  onOpenWorkspace(): void;
  onOpenFile(): void;
  onOpenRecent(index: number): void;
}

export function EmptyState(p: Props) {
  const [recent, setRecent] = useState<RecentItem[]>([]);
  useEffect(() => {
    api.open.recent().then(setRecent, () => setRecent([]));
  }, []);
  const mod = api.platform === "darwin" ? "⌘" : "Ctrl+";
  const shift = api.platform === "darwin" ? "⌘⇧" : "Ctrl+Shift+";

  return (
    <div className="empty-state" data-testid="empty-state">
      <h2>打开一个工作区或文件开始阅读</h2>
      <p className="muted">支持 PDF、Word、Excel 和 Markdown，也可以把文件或文件夹直接拖到这里。</p>
      <div className="empty-actions">
        <button className="primary" onClick={p.onOpenWorkspace}>
          打开工作区 <kbd>{mod}O</kbd>
        </button>
        <button onClick={p.onOpenFile}>
          打开文件 <kbd>{shift}O</kbd>
        </button>
      </div>
      {recent.length > 0 && (
        <ul className="recent-list" aria-label="最近打开">
          {recent.map((r, i) => (
            <li key={`${r.kind}:${r.path}`}>
              <button onClick={() => p.onOpenRecent(i)} title={r.path}>
                <span className="recent-kind">{r.kind === "workspace" ? "工作区" : "文件"}</span>
                <span className="recent-name">{r.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
