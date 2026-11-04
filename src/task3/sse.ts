/** Parse OpenAI-compatible Server-Sent Events and yield only delta.content text. */
export async function* openAiDeltaText(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separator: RegExpExecArray | null;
      while ((separator = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const boundary = separator.index;
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + separator[0].length);
        for (const line of event.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> };
            const content = parsed.choices?.[0]?.delta?.content;
            if (typeof content === "string" && content.length) yield content;
          } catch {
            // Ignore malformed provider event frames; do not leak raw provider payloads.
          }
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      for (const line of buffer.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> };
          const content = parsed.choices?.[0]?.delta?.content;
          if (typeof content === "string" && content.length) yield content;
        } catch { /* Ignore an incomplete final event. */ }
      }
    }
  } finally { reader.releaseLock(); }
}
