import type { ActiveModel } from "../shared/ipc";
import { modelTooltip } from "../shared/model-name";

interface Props {
  workspace: string | null;
  docTitle: string | null;
  model: ActiveModel | null;
  /** false → active provider has no key: show 未配置, never a model name. null = not loaded yet. */
  configured: boolean | null;
}

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** 24px status bar: where you are on the left; on the right the model picked in ModelBar (the one that answers) and whether it reads images. */
export function StatusBar({ workspace, docTitle, model, configured }: Props) {
  return (
    <footer className="statusbar" data-testid="statusbar">
      <span className="statusbar-item" title={workspace ?? undefined}>
        {workspace ? baseName(workspace) : "未打开工作区"}
        {docTitle && <span className="statusbar-sep">/</span>}
        {docTitle}
      </span>
      {configured === false && (
        <span className="statusbar-right">
          <span className="statusbar-item" data-testid="status-unconfigured">
            未配置
          </span>
        </span>
      )}
      {model && configured && (
        <span className="statusbar-right">
          <span className="statusbar-item" data-testid="status-model" title={modelTooltip(model)}>
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
