import { describe, expect, it } from "vitest";

import { redactTextStream } from "../src/task3/redactor.js";

async function collect(chunks: string[]): Promise<string> {
  let output = "";

  async function* source() {
    for (const chunk of chunks) {
      yield chunk;
    }
  }

  for await (const chunk of redactTextStream(source())) {
    output += chunk;
  }

  return output;
}

describe("Task 3 - Streaming PII Redaction", () => {
  it("redacts email, SSN and credit card numbers", async () => {
    const result = await collect([
      "Contact jane.doe@example.com, ",
      "SSN 123-45-6789, ",
      "card 4111 1111 1111 1111"
    ]);

    expect(result).not.toContain("jane.doe@example.com");
    expect(result).not.toContain("123-45-6789");
    expect(result).not.toContain("4111 1111 1111 1111");

    expect(result.match(/\[REDACTED\]/g)?.length).toBe(3);
  });

  it("detects an email split across chunks", async () => {
    const result = await collect([
      "Reach me at jane.doe@exa",
      "mple.",
      "com for details"
    ]);

    expect(result).not.toContain("jane.doe@example.com");
    expect(result).toContain("[REDACTED]");
  });

  it("detects an SSN split across chunks", async () => {
    const result = await collect([
      "My SSN is 123-",
      "45-",
      "6789."
    ]);

    expect(result).not.toContain("123-45-6789");
    expect(result).toContain("[REDACTED]");
  });

  it("detects a credit card split across chunks", async () => {
    const result = await collect([
      "Card: 4111 1111 ",
      "1111 ",
      "1111"
    ]);

    expect(result).not.toContain("4111 1111 1111 1111");
    expect(result).toContain("[REDACTED]");
  });

  it("preserves ordinary text without changing it", async () => {
    const result = await collect([
      "Hello, ",
      "this is a normal response."
    ]);

    expect(result).toBe("Hello, this is a normal response.");
  });

  it("redacts multiple sensitive values in one stream", async () => {
    const result = await collect([
      "Email: user@example.com. ",
      "SSN: 123-45-6789. ",
      "Card: 4111111111111111."
    ]);

    expect(result).not.toContain("user@example.com");
    expect(result).not.toContain("123-45-6789");
    expect(result).not.toContain("4111111111111111");

    expect(result.match(/\[REDACTED\]/g)?.length).toBe(3);
  });
});