import { describe, expect, it } from "vitest";
import { redactTextStream } from "../src/task3/redactor.js";

describe("Task 3 - Streaming behavior", () => {
  it("emits safe text before the source stream finishes", async () => {
    let releaseSource!: () => void;
    let sourceFinished = false;

    // Create the release function before the generator starts.
    const sourceGate = new Promise<void>((resolve) => {
      releaseSource = resolve;
    });

    async function* source() {
      // More than the 320-character holdback.
      yield "This is ordinary text. ".repeat(20);

      // Pause until the test explicitly releases the source.
      await sourceGate;

      sourceFinished = true;
      yield "Final response.";
    }

    const iterator = redactTextStream(source());

    // The first safe chunk should arrive while the source is paused.
    const first = await iterator.next();

    expect(first.done).toBe(false);
    expect(first.value.length).toBeGreaterThan(0);
    expect(sourceFinished).toBe(false);

    // Allow the source to finish.
    releaseSource();

    let remaining = "";

    while (true) {
      const result = await iterator.next();

      if (result.done) break;

      remaining += result.value;
    }

    expect(sourceFinished).toBe(true);
    expect(remaining).toContain("Final response.");
  });
});