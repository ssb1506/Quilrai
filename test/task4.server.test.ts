import {
  describe,
  it,
  expect,
  afterEach
} from "vitest";

import request from "supertest";

import { TokenRateLimiter } from "../src/task4/rateLimiter.js";
import { createTask4App } from "../src/task4/app.js";

import type { ModelCall } from "../src/task4/modelRouter.js";

describe("Task 4 - HTTP Model Gateway", () => {
  let limiter: TokenRateLimiter;

  afterEach(() => {
    limiter?.close();
  });

  function createTestApp(call: ModelCall) {
    limiter = new TokenRateLimiter(":memory:");

    return createTask4App({
      limiter,
      call,
      primaryModel: "primary",
      backupModel: "backup",
      timeoutMs: 100
    });
  }

  it("rejects requests without a tenant API key", async () => {
    const app = createTestApp(async () => ({
      status: 200,
      body: {}
    }));

    const response = await request(app)
      .post("/v1/completions")
      .send({ prompt: "Hello", max_tokens: 100 });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("unauthorized");
  });

  it("rejects invalid token budgets", async () => {
    const app = createTestApp(async () => ({
      status: 200,
      body: {}
    }));

    const response = await request(app)
      .post("/v1/completions")
      .set("x-tenant-api-key", "tenant-a")
      .send({ prompt: "Hello", max_tokens: -10 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_request");
  });

  it("returns a successful primary provider response", async () => {
    const app = createTestApp(async (model) => ({
      status: 200,
      body: { answer: "Hello" }
    }));

    const response = await request(app)
      .post("/v1/completions")
      .set("x-tenant-api-key", "tenant-a")
      .send({ prompt: "Hello", max_tokens: 100 });

    expect(response.status).toBe(200);
    expect(response.body.model).toBe("primary");
    expect(response.body.data.answer).toBe("Hello");
  });

  it("rejects requests that exceed the tenant token quota", async () => {
    const app = createTestApp(async () => ({
      status: 200,
      body: {}
    }));

    const response = await request(app)
      .post("/v1/completions")
      .set("x-tenant-api-key", "tenant-a")
      .send({ prompt: "Hello", max_tokens: 50001 });

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe("rate_limit_exceeded");
  });

  it("uses the backup provider after a primary 429", async () => {
    const calledModels: string[] = [];

    const app = createTestApp(async (model) => {
      calledModels.push(model);

      return {
        status: model === "primary" ? 429 : 200,
        body: { answer: "Backup response" }
      };
    });

    const response = await request(app)
      .post("/v1/completions")
      .set("x-tenant-api-key", "tenant-a")
      .send({ prompt: "Hello", max_tokens: 100 });

    expect(response.status).toBe(200);
    expect(response.body.model).toBe("backup");
    expect(calledModels).toEqual(["primary", "backup"]);
  });

  it("returns a sanitized error if both providers fail", async () => {
    const app = createTestApp(async () => ({
      status: 503,
      body: { internal: "provider details" }
    }));

    const response = await request(app)
      .post("/v1/completions")
      .set("x-tenant-api-key", "tenant-a")
      .send({ prompt: "Hello", max_tokens: 100 });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("models_unavailable");
    expect(response.text).not.toContain("provider details");
  });
});