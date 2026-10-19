import type { ActiveModel } from "../shared/ipc";

interface Props {
  workspace: string | null;
  docTitle: string | null;
  model: ActiveModel | null;
  /** false → active provider has no key: show 未配置, never a model name. */
  configured: boolean;
}

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** 24px status bar: where you are on the left, which model answers (and whether it reads images) on the right. */
export function StatusBar({ workspace, docTitle, model, configured }: Props) {
  return (
    <footer className="statusbar" data-testid="statusbar">
      <span className="statusbar-item" title={workspace ?? undefined}>
        {workspace ? baseName(workspace) : "未打开工作区"}
        {docTitle && <span className="statusbar-sep">/</span>}
        {docTitle}
      </span>
      {model && !configured && (
        <span className="statusbar-right">
          <span className="statusbar-item" data-testid="status-unconfigured">
            未配置
          </span>
        </span>
      )}
      {model && configured && (
        <span className="statusbar-right">
          <span className="statusbar-item" data-testid="status-model" title={`${model.providerName} · ${model.model}`}>
            {model.model}
          </span>
          <span className="statusbar-item" data-testid="status-vision">
            {model.vision ? "支持看图" : "不支持看图"}
          </span>
        </span>
      )}
    </footer>
  );
}
