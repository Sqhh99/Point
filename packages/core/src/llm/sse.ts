/** Parse an SSE byte stream into `data:` payloads. Handles chunks split anywhere. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let data: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buf += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line === "") {
          if (data.length) yield data.join("\n");
          data = [];
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (done) {
        if (buf.startsWith("data:")) data.push(buf.slice(5).replace(/^ /, ""));
        if (data.length) yield data.join("\n");
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
