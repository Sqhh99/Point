/** User-facing copy (UI设计员 spec) for a file Point cannot open. Raw errors only go to the log. */
export const OPEN_ERROR = {
  encrypted: "这个 PDF 设置了密码，暂时无法打开。",
  corrupt: "文件可能已损坏，无法打开。",
  empty: "这个文件是空的。",
  missing: "找不到这个文件，可能已被移动或删除。"
} as const;

/** Map a parser failure to the spec copy; logs the raw error. */
export function friendlyParseError(err: unknown, bytes: number): Error {
  console.error("[point] open failed:", err);
  if (bytes === 0) return new Error(OPEN_ERROR.empty);
  const e = err as { name?: string; message?: string } | undefined;
  if (e?.name === "PasswordException" || /password/i.test(e?.message ?? "")) return new Error(OPEN_ERROR.encrypted);
  return new Error(OPEN_ERROR.corrupt);
}
