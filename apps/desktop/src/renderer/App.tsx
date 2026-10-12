import { useCallback, useEffect, useRef, useState } from "react";
import type { DocMeta, WorkspaceInfo } from "../shared/ipc";
import { AIPanel, type TaskTrigger } from "./AIPanel";
import { Library } from "./Library";
import { Reader } from "./Reader";
import { Settings } from "./Settings";
import { TitleBar } from "./TitleBar";
import { clampChatWidth, isToggleLibraryKey } from "./layout";

const api = window.point;

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo>({ path: null });
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<"reader" | "settings">("reader");
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<TaskTrigger | null>(null);
  const [docTitle, setDocTitle] = useState<string | null>(null);
  const [chatWidth, setChatWidth] = useState(() => clampChatWidth(localStorage.getItem("point.chatWidth")));
  const drag = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isToggleLibraryKey(e)) {
        e.preventDefault();
        setLibraryOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const startResize = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, w: chatWidth };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onResize = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setChatWidth(clampChatWidth(drag.current.w + drag.current.x - e.clientX));
  };
  const endResize = () => {
    drag.current = null;
    localStorage.setItem("point.chatWidth", String(chatWidth));
  };

  const refresh = useCallback(async () => {
    setWorkspace(await api.workspace.get());
    setDocs(await api.docs.list());
  }, []);

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  const run = (fn: () => Promise<void>) => () => {
    setError(null);
    fn().catch((e: Error) => setError(e.message));
  };

  const chooseWorkspace = run(async () => {
    await api.workspace.choose();
    setActiveId(null);
    await refresh();
  });

  const importDocs = run(async () => {
    const added = await api.docs.import();
    await refresh();
    if (added[0]) {
      setActiveId(added[0].id);
      setView("reader");
    }
  });

  return (
    <div className="shell">
    <TitleBar workspace={workspace.path} fileName={view === "settings" ? "设置" : docTitle} onOpenWorkspace={chooseWorkspace} onImport={importDocs} />
    <div className={`desk${libraryOpen ? "" : " library-collapsed"}`} style={{ "--chat-width": `${chatWidth}px` } as React.CSSProperties}>
      <Library
        open={libraryOpen}
        onToggle={() => setLibraryOpen((o) => !o)}
        workspace={workspace.path}
        docs={docs}
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id);
          setView("reader");
        }}
        onChooseWorkspace={chooseWorkspace}
        onImport={importDocs}
        onOpenSettings={() => setView("settings")}
        settingsActive={view === "settings"}
      />
      <main className="center">
        {error && (
          <div className="banner" role="alert">
            {error}
          </div>
        )}
        {view === "settings" ? <Settings onClose={() => setView("reader")} /> : (
          <Reader
            docId={activeId}
            hasWorkspace={!!workspace.path}
            onDocLoaded={(d) => setDocTitle(d?.title ?? null)}
            onAction={(kind, sel) => setTrigger((t) => ({ seq: (t?.seq ?? 0) + 1, kind, sel }))}
          />
        )}
      </main>
      <div className="col-resizer" role="separator" aria-orientation="vertical" aria-label="调整对话面板宽度" onPointerDown={startResize} onPointerMove={onResize} onPointerUp={endResize} />
      <AIPanel
        trigger={trigger}
        docId={activeId}
        docTitle={docTitle}
        hasWorkspace={!!workspace.path}
        onOpenSettings={() => setView("settings")}
      />
    </div>
    </div>
  );
}
