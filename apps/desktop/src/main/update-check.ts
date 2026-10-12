import { app, dialog, shell } from "electron";

export const RELEASES_API = "https://api.github.com/repos/Sqhh99/Point/releases/latest";

export interface UpdateInfo {
  version: string;
  url: string;
}

/** Compares "1.2.3" style versions; a leading "v" and any "-prerelease" suffix are ignored. */
export function isNewer(latest: string, current: string): boolean {
  const parts = (v: string) => v.replace(/^v/, "").split("-")[0].split(".").map((n) => Number(n) || 0);
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** Asks GitHub for the latest published release. Any network or format problem means "no update". */
export async function checkForUpdate(current: string, fetchImpl: typeof fetch = fetch): Promise<UpdateInfo | null> {
  try {
    const res = await fetchImpl(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown };
    if (typeof body.tag_name !== "string" || typeof body.html_url !== "string") return null;
    if (body.draft || body.prerelease) return null;
    if (!body.html_url.startsWith("https://github.com/Sqhh99/Point/")) return null;
    return isNewer(body.tag_name, current) ? { version: body.tag_name.replace(/^v/, ""), url: body.html_url } : null;
  } catch {
    return null;
  }
}

/** Windows installs from Inno Setup have no auto-update: check once at startup and offer the download page. */
export async function notifyIfUpdateAvailable(): Promise<void> {
  if (process.platform !== "win32" || !app.isPackaged) return;
  if (process.env.POINT_USER_DATA || process.env.POINT_FAKE_LLM || process.env.POINT_SMOKE_OUT) return;
  const info = await checkForUpdate(app.getVersion());
  if (!info) return;
  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "Point 有新版本",
    message: `Point ${info.version} 已发布，当前版本是 ${app.getVersion()}。`,
    detail: "请到下载页获取新的安装包，覆盖安装不会影响你的笔记和设置。",
    buttons: ["去下载", "以后再说"],
    defaultId: 0,
    cancelId: 1
  });
  if (response === 0) await shell.openExternal(info.url);
}
