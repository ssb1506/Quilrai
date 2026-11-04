
import "dotenv/config";

import { TokenRateLimiter } from "./rateLimiter.js";
import { createTask4App } from "./app.js";
import type { ModelCall } from "./modelRouter.js";

const port = Number(process.env.ROUTER_PORT ?? 3003);

const primary = process.env.PRIMARY_MODEL ?? "primary-model";
const backup = process.env.BACKUP_MODEL ?? "backup-model";

const primaryProvider = {
  url: process.env.LLM_PROVIDER_URL ||
    "https://api.openai.com/v1/chat/completions",
  apiKey: process.env.LLM_API_KEY
};

const backupProvider = {
  url: process.env.BACKUP_PROVIDER_URL,
  apiKey: process.env.BACKUP_API_KEY
};

const limiter = new TokenRateLimiter(
  process.env.SQLITE_PATH ?? "./data/usage.sqlite"
);

const call: ModelCall = async (model, payload, signal, provider) => {
  const config =
    provider === "primary" ? primaryProvider : backupProvider;

  if (!config.url) {
    throw new Error("Backup provider URL is not configured");
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.apiKey
        ? { authorization: `Bearer ${config.apiKey}` }
        : {})
    },
    body: JSON.stringify({
      ...(payload as object),
      model
    }),
    signal
  });

  return {
    status: response.status,
    body: await response.json().catch(() => ({}))
  };
};

const app = createTask4App({
  limiter,
  call,
  primaryModel: primary,
  backupModel: backup,
  timeoutMs: 3000
});

const server = app.listen(port, () => {
  console.error(`LLM model router listening on ${port}`);
});

function shutdown() {
  server.close(() => {
    limiter.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
