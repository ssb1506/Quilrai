import express from "express";
import { redactTextStream } from "./redactor.js";
import { openAiDeltaText } from "./sse.js";

export interface LlmGatewayOptions { providerUrl: string; apiKey?: string; model?: string }
export function createLlmGateway({ providerUrl, apiKey, model = "gpt-4o-mini" }: LlmGatewayOptions) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.post("/v1/generate", async (req, res) => {
    const prompt = req.body?.prompt;
    if (typeof prompt !== "string" || !prompt.trim()) return res.status(400).json({ error: { code: "invalid_request", message: "prompt is required" } });
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    try {
      const upstream = await fetch(providerUrl, {
        method: "POST", headers,
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], stream: true }),
        signal: AbortSignal.timeout(60_000)
      });
      if (!upstream.ok || !upstream.body) return res.status(502).json({ error: { code: "upstream_error", message: "The model provider could not complete the request" } });
      res.status(200);
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader("cache-control", "no-cache, no-transform");
      res.setHeader("x-accel-buffering", "no");
      for await (const safeChunk of redactTextStream(openAiDeltaText(upstream.body))) {
        if (res.destroyed) break;
        if (!res.write(safeChunk)) await new Promise<void>(resolve => res.once("drain", resolve));
      }
      if (!res.destroyed) res.end();
    } catch {
      if (!res.headersSent) res.status(502).json({ error: { code: "gateway_error", message: "Generation service is temporarily unavailable" } });
      else res.destroy();
    }
  });
  return app;
}
