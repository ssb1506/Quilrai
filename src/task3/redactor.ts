const PII_PATTERNS: RegExp[] = [
  // Email addresses
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,

  // US Social Security Numbers
  /\b\d{3}-\d{2}-\d{4}\b/g,

  // Credit/debit card numbers: 13–19 digits, optionally separated
  // by spaces or hyphens.
  /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g
];

const MARKER = "[REDACTED]";

/**
 * Streaming PII redactor.
 *
 * Holds a bounded tail of text so supported PII patterns split
 * across incoming chunks can be detected before output is released.
 *
 * The 320-character holdback accommodates standard-length email
 * addresses and the shorter SSN/card patterns supported here.
 */
export async function* redactTextStream(
  source: AsyncIterable<Uint8Array | string>,
  holdback = 320
): AsyncGenerator<string> {
  if (!Number.isInteger(holdback) || holdback < 320) {
    throw new Error("holdback must be an integer of at least 320");
  }

  const decoder = new TextDecoder();
  let pending = "";

  const redact = (value: string): string => {
    return PII_PATTERNS.reduce(
      (text, pattern) => text.replace(pattern, MARKER),
      value
    );
  };

  for await (const chunk of source) {
    pending +=
      typeof chunk === "string"
        ? chunk
        : decoder.decode(chunk, { stream: true });

    if (pending.length <= holdback) {
      continue;
    }

    let boundary = pending.length - holdback;

    // If a complete PII match crosses the output boundary,
    // retain the entire match until it can be redacted.
    for (const pattern of PII_PATTERNS) {
      const matcher = new RegExp(pattern.source, pattern.flags);

      for (const match of pending.matchAll(matcher)) {
        const start = match.index ?? 0;
        const end = start + match[0].length;

        if (start < boundary && end > boundary) {
          boundary = start;
        }
      }
    }

    if (boundary > 0) {
      yield redact(pending.slice(0, boundary));
      pending = pending.slice(boundary);
    }
  }

  // Flush any remaining UTF-8 decoder state.
  pending += decoder.decode();

  // Redact the final buffered content.
  if (pending.length > 0) {
    yield redact(pending);
  }
}