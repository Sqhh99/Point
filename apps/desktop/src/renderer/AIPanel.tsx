import { useState } from "react";

export function AIPanel() {
  const [tab, setTab] = useState<"chat" | "notes">("chat");
  return (
    <aside className="ai-panel" aria-label="AI 面板">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")}>
          对话
        </button>
        <button role="tab" aria-selected={tab === "notes"} onClick={() => setTab("notes")}>
          笔记
        </button>
      </div>
      <div className="panel-body placeholder">{tab === "chat" ? "选中文字后向 AI 提问（下一步实现）" : "笔记会出现在这里（下一步实现）"}</div>
    </aside>
  );
}
