import express from "express";

import { TokenRateLimiter } from "./rateLimiter.js";
import { routeWithFallback, type ModelCall } from "./modelRouter.js";

export interface Task4AppOptions {
  limiter: TokenRateLimiter;
  call: ModelCall;
  primaryModel: string;
  backupModel: string;
  timeoutMs?: number;
}

export function createTask4App(options: Task4AppOptions) {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.post("/v1/completions", async (req, res) => {
    const tenantKey = req.header("x-tenant-api-key");

    if (!tenantKey) {
      return res.status(401).json({
        error: {
          code: "unauthorized",
          message: "Tenant API key is required"
        }
      });
    }

    const tokens = req.body?.max_tokens ?? 1000;

    if (!Number.isSafeInteger(tokens) || tokens <= 0) {
      return res.status(400).json({
        error: {
          code: "invalid_request",
          message: "max_tokens must be a positive integer"
        }
      });
    }

    try {
      // Reserve the requested maximum token budget against the tenant quota.
      const quota = options.limiter.consume(tenantKey, tokens);

      if (!quota.allowed) {
        return res.status(429).json({
          error: {
            code: "rate_limit_exceeded",
            message: "Tenant token limit exceeded",
            limit: quota.limit,
            used: quota.used,
            retry_after_ms: quota.retryAfterMs
          }
        });
      }

      const result = await routeWithFallback(
        options.call,
        req.body,
        options.primaryModel,
        options.backupModel,
        options.timeoutMs ?? 3000
      );

      return res.status(200).json({
        model: result.model,
        data: result.response.body
      });
    } catch {
      return res.status(503).json({
        error: {
          code: "models_unavailable",
          message: "All configured model providers are temporarily unavailable"
        }
      });
    }
  });

  return app;
}