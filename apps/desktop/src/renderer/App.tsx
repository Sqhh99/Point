import { useCallback, useEffect, useRef, useState } from "react";
import type { ActiveModel, CaptureResult, DocMeta, OpenResult, WorkspaceInfo } from "../shared/ipc";
import type { Mark, MarkAnchor } from "@point/core";
import { AIPanel, type BatchTrigger, type TaskTrigger } from "./AIPanel";
import { Library } from "./Library";
import { Reader } from "./Reader";
import { Settings } from "./Settings";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import { clampChatWidth, deskVars, isToggleLibraryKey, openShortcutOf } from "./layout";

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
  const [configured, setConfigured] = useState<boolean | null>(null);
  // The model picked in ModelBar (name + ModelSpec.vision / custom declaration): status bar and the
  // region tool read the same value the ask gate uses.
  const [picked, setPicked] = useState<ActiveModel | null>(null);
  const [capture, setCapture] = useState<(CaptureResult & { seq: number }) | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [batch, setBatch] = useState<BatchTrigger | null>(null);
  const [locate, setLocate] = useState<{ blockId?: string; page?: number; text?: string; seq: number } | null>(null);
  const drag = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const o = openShortcutOf(e, api.platform);
      if (o) {
        e.preventDefault();
        (o === "file" ? shortcuts.current.openFile : shortcuts.current.chooseWorkspace)();
        return;
      }
      if (isToggleLibraryKey(e, api.platform)) {
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

  const loadMarks = useCallback(async (docId: string | null) => {
    setMarks(docId ? await api.marks.list(docId) : []);
  }, []);
  useEffect(() => {
    setChecked([]);
    loadMarks(activeId).catch((e: Error) => setError(e.message));
  }, [activeId, loadMarks]);

  const addMark = (anchor: MarkAnchor) => {
    if (!activeId) return;
    setError(null);
    api.marks
      .create(activeId, anchor)
      .then(() => loadMarks(activeId))
      .catch((e: Error) => setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")));
  };
  const removeMark = (id: string) => {
    setChecked((c) => c.filter((x) => x !== id));
    api.marks.remove(id).then(() => loadMarks(activeId), (e: Error) => setError(e.message));
  };
  const batchAsk = () => {
    const picked = checked.map((id) => marks.find((m) => m.id === id)).filter((m): m is Mark => !!m);
    if (picked.length) setBatch((b) => ({ seq: (b?.seq ?? 0) + 1, marks: picked }));
    setChecked([]);
  };

  const refreshModel = useCallback(() => {
    api.settings.get().then(
      (s) => {
        setConfigured(s.configured);
      },
      () => setConfigured(null)
    );
  }, []);
  // Re-read after leaving settings, and whenever main broadcasts settings:changed (save / setKey).
  useEffect(() => {
    if (view !== "reader") return;
    refreshModel();
  }, [view, refreshModel]);
  useEffect(() => api.settings.onChanged(refreshModel), [refreshModel]);

  const run = (fn: () => Promise<void>) => () => {
    setError(null);
    fn().catch((e: Error) => setError(e.message));
  };

  const applyOpen = async (r: OpenResult) => {
    await refresh();
    setActiveId(r.doc?.id ?? null);
    setView("reader");
  };
  const chooseWorkspace = run(async () => applyOpen(await api.open.workspace()));
  const openFile = run(async () => applyOpen(await api.open.file()));
  const openRecent = (i: number, p: string) => run(async () => applyOpen(await api.open.recentAt(i, p)))();
  const opened = useRef(applyOpen);
  opened.current = applyOpen;
  useEffect(() => api.open.onOpened((r) => void opened.current(r).catch((e: Error) => setError(e.message))), []);
  const shortcuts = useRef({ chooseWorkspace, openFile });
  shortcuts.current = { chooseWorkspace, openFile };

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
    <TitleBar workspace={workspace.path} fileName={view === "settings" ? "设置" : docTitle} onOpenWorkspace={chooseWorkspace} onOpenFile={openFile} onImport={importDocs} />
    <div className={`desk${libraryOpen ? "" : " library-collapsed"}`} style={deskVars(chatWidth)}>
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
        onOpenFile={openFile}
        onOpenSettings={() => setView("settings")}
        settingsActive={view === "settings"}
        marks={marks}
        checked={checked}
        onToggleMark={(id) => setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))}
        onLocateMark={(m) => {
          setView("reader");
          const a = m.anchor;
          const blockId = a.blockId;
          const page = a.kind === "text" ? a.page : undefined;
          if (blockId || page) setLocate((l) => ({ blockId, page, text: a.kind === "text" ? a.text : undefined, seq: (l?.seq ?? 0) + 1 }));
        }}
        onRemoveMark={removeMark}
        onBatchAsk={batchAsk}
      />
      <main className="center">
        {error && (
          <div className="banner" role="alert">
            {error}
          </div>
        )}
        {view === "settings" ? <Settings onClose={() => setView("reader")} onSaved={refreshModel} /> : (
          <Reader
            docId={activeId}
            hasWorkspace={!!workspace.path}
            onOpenWorkspace={chooseWorkspace}
            onOpenFile={openFile}
            onOpenRecent={openRecent}
            onDocLoaded={(d) => setDocTitle(d?.title ?? null)}
            onAction={(kind, sel) => setTrigger((t) => ({ seq: (t?.seq ?? 0) + 1, kind, sel }))}
            vision={!!picked?.vision}
            onCapture={(r) => setCapture((c) => ({ ...r, seq: (c?.seq ?? 0) + 1 }))}
            onCaptureError={setError}
            onMark={addMark}
            onRegionExplain={(r) => setTrigger((t) => ({ seq: (t?.seq ?? 0) + 1, kind: "explain", sel: { text: "", context: "", page: r.page }, image: r.sha }))}
            marks={marks}
            locate={locate}
          />
        )}
      </main>
      <div className="col-resizer" role="separator" aria-orientation="vertical" aria-label="调整对话面板宽度" onPointerDown={startResize} onPointerMove={onResize} onPointerUp={endResize} />
      <AIPanel
        trigger={trigger}
        docId={activeId}
        docTitle={docTitle}
        hasWorkspace={!!workspace.path}
        onPick={setPicked}
        capture={capture}
        batch={batch}
        onOpenSettings={() => setView("settings")}
      />
    </div>
    <StatusBar workspace={workspace.path} docTitle={view === "settings" ? null : docTitle} model={picked} configured={configured} />
    </div>
  );
}
