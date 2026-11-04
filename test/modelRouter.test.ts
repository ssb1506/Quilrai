import { describe, expect, it } from "vitest";
import { routeWithFallback } from "../src/task4/modelRouter.js";

describe("Task 4 - Model Fallback Router", () => {
  it("fails over after a primary 429", async () => {
    const models: string[] = [];

    const result = await routeWithFallback(
      async (model) => {
        models.push(model);

        return {
          status: model === "primary" ? 429 : 200,
          body: {}
        };
      },
      {},
      "primary",
      "backup"
    );

    expect(result.model).toBe("backup");
    expect(models).toEqual(["primary", "backup"]);
  });

  it("fails over after a primary timeout", async () => {
    const result = await routeWithFallback(
      async (model, _payload, signal) => {
        if (model === "primary") {
          return new Promise((_, reject) => {
            signal.addEventListener("abort", () => {
              reject(new Error("aborted"));
            });
          });
        }

        return {
          status: 200,
          body: { ok: true }
        };
      },
      {},
      "primary",
      "backup",
      10
    );

    expect(result.model).toBe("backup");
  });

  it("fails over after a primary server error", async () => {
    const models: string[] = [];

    const result = await routeWithFallback(
      async (model) => {
        models.push(model);

        return {
          status: model === "primary" ? 500 : 200,
          body: {}
        };
      },
      {},
      "primary",
      "backup"
    );

    expect(result.model).toBe("backup");
    expect(models).toEqual(["primary", "backup"]);
  });

  it("returns a sanitized error when both providers fail", async () => {
    await expect(
      routeWithFallback(
        async () => ({
          status: 503,
          body: {}
        }),
        {},
        "primary",
        "backup"
      )
    ).rejects.toThrow("ALL_MODELS_UNAVAILABLE");
  });

  it("does not fail over for ordinary primary client errors", async () => {
    const models: string[] = [];

    const result = await routeWithFallback(
      async (model) => {
        models.push(model);

        return {
          status: 400,
          body: { error: "Invalid request" }
        };
      },
      {},
      "primary",
      "backup"
    );

    expect(result.model).toBe("primary");
    expect(result.response.status).toBe(400);
    expect(models).toEqual(["primary"]);
  });
  it("uses separate primary and backup provider configurations", async () => {
  const providers: string[] = [];

  const result = await routeWithFallback(
    async (_model, _payload, _signal, provider) => {
      providers.push(provider);

      return {
        status: provider === "primary" ? 429 : 200,
        body: { ok: true }
      };
    },
    {},
    "primary-model",
    "backup-model"
  );

  expect(result.model).toBe("backup-model");
  expect(providers).toEqual(["primary", "backup"]);
  });
  it("fails over when the primary provider has a network error", async () => {
  const providers: string[] = [];

  const result = await routeWithFallback(
    async (_model, _payload, _signal, provider) => {
      providers.push(provider);

      if (provider === "primary") {
        throw new Error("Network connection failed");
      }

      return { status: 200, body: { ok: true } };
    },
    {},
    "primary",
    "backup"
  );

  expect(result.model).toBe("backup");
  expect(providers).toEqual(["primary", "backup"]);
});

it("does not expose backup provider errors", async () => {
  await expect(
    routeWithFallback(
      async (_model, _payload, _signal, provider) => {
        throw new Error(`${provider} secret provider details`);
      },
      {},
      "primary",
      "backup"
    )
  ).rejects.toThrow("ALL_MODELS_UNAVAILABLE");
});
});