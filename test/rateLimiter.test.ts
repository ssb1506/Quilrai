import { describe, expect, it } from "vitest";
import { TokenRateLimiter } from "../src/task4/rateLimiter.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("Task 4 - Token Sliding Window Limiter", () => {
  it("allows requests up to 50,000 tokens and rejects over-limit usage", () => {
    const limiter = new TokenRateLimiter(":memory:");

    expect(limiter.consume("tenant-a", 30_000, 100_000).allowed).toBe(true);
    expect(limiter.consume("tenant-a", 20_000, 100_001).allowed).toBe(true);
    expect(limiter.consume("tenant-a", 1, 100_002).allowed).toBe(false);

    limiter.close();
  });

  it("evicts events outside the rolling window", () => {
    const limiter = new TokenRateLimiter(":memory:");

    limiter.consume("tenant-a", 50_000, 100_000);

    expect(limiter.consume("tenant-a", 10_000, 160_001).allowed).toBe(true);

    limiter.close();
  });

  it("isolates usage between different tenants", () => {
    const limiter = new TokenRateLimiter(":memory:");

    limiter.consume("tenant-a", 50_000, 100_000);

    const result = limiter.consume("tenant-b", 50_000, 100_001);

    expect(result.allowed).toBe(true);
    expect(result.used).toBe(50_000);

    limiter.close();
  });

  it("rejects a single request exceeding the token limit", () => {
    const limiter = new TokenRateLimiter(":memory:");

    const result = limiter.consume("tenant-a", 50_001, 100_000);

    expect(result.allowed).toBe(false);
    expect(result.used).toBe(0);

    limiter.close();
  });

  it("rejects invalid token counts and missing tenant keys", () => {
    const limiter = new TokenRateLimiter(":memory:");

    expect(() => limiter.consume("", 100)).toThrow();
    expect(() => limiter.consume("tenant-a", -1)).toThrow();
    expect(() => limiter.consume("tenant-a", 1.5)).toThrow();

    limiter.close();
  });

  it("persists token usage after closing and reopening SQLite", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "quilrai-rate-limit-")
    );

    const databasePath = path.join(tempDirectory, "usage.sqlite");

    try {
      const firstLimiter = new TokenRateLimiter(databasePath);

      const firstResult = firstLimiter.consume(
        "tenant-a",
        30_000,
        100_000
      );

      expect(firstResult.allowed).toBe(true);
      firstLimiter.close();

      const secondLimiter = new TokenRateLimiter(databasePath);

      const secondResult = secondLimiter.consume(
        "tenant-a",
        20_000,
        100_001
      );

      expect(secondResult.allowed).toBe(true);
      expect(secondResult.used).toBe(50_000);

      const thirdResult = secondLimiter.consume(
        "tenant-a",
        1,
        100_002
      );

      expect(thirdResult.allowed).toBe(false);

      secondLimiter.close();
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("calculates retry time based on the earliest required token expiration", () => {
    const limiter = new TokenRateLimiter(":memory:");

    limiter.consume("tenant-a", 40_000, 100_000);
    limiter.consume("tenant-a", 10_000, 110_000);

    const result = limiter.consume("tenant-a", 20_000, 115_000);

    expect(result.allowed).toBe(false);
    expect(result.used).toBe(50_000);
    expect(result.retryAfterMs).toBe(45_000);

    limiter.close();
  });

  it("shares quota safely across separate SQLite connections", () => {
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "quilrai-concurrent-")
    );

    const databasePath = path.join(tempDirectory, "usage.sqlite");

    const firstLimiter = new TokenRateLimiter(databasePath);
    const secondLimiter = new TokenRateLimiter(databasePath);

    try {
      const first = firstLimiter.consume("tenant-a", 30_000, 100_000);
      const second = secondLimiter.consume("tenant-a", 30_000, 100_001);

      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(false);
      expect(second.used).toBe(30_000);
    } finally {
      firstLimiter.close();
      secondLimiter.close();
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

});