export type LLMErrorCode = "auth" | "rate_limit" | "server" | "bad_request" | "network" | "aborted";

export class LLMError extends Error {
  constructor(
    readonly code: LLMErrorCode,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "LLMError";
  }
}

/** Only the vendor's `error.message` (OpenAI-compatible shape) is shown; never the raw body. */
function vendorMessage(body: string): string | undefined {
  try {
    const v = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
    const m = typeof v?.error === "object" && v.error ? v.error.message : typeof v?.error === "string" ? v.error : v?.message;
    return typeof m === "string" && m.trim() ? m.trim().slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}

export function errorFromStatus(status: number, body: string): LLMError {
  const m = vendorMessage(body);
  const detail = m ? `: ${m}` : "";
  if (status === 401 || status === 403) return new LLMError("auth", `鉴权失败 (${status})${detail}`, status);
  if (status === 429) return new LLMError("rate_limit", `请求过于频繁 (429)${detail}`, status);
  if (status >= 500) return new LLMError("server", `服务端错误 (${status})${detail}`, status);
  return new LLMError("bad_request", `请求错误 (${status})${detail}`, status);
}
