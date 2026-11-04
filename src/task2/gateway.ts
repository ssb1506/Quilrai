
import express, { type Request, type Response } from "express";

export interface GatewayOptions {
  downstreamUrl: string;
  tokenRoles?: Record<string, "admin" | "viewer">;
}

export function createMcpGateway({
  downstreamUrl,
  tokenRoles = {
    "admin-token": "admin",
    "viewer-token": "viewer"
  }
}: GatewayOptions) {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.post("/rpc", async (req: Request, res: Response) => {
    const payload = req.body;

    if (
      !payload ||
      typeof payload !== "object" ||
      typeof payload.jsonrpc !== "string" ||
      payload.jsonrpc !== "2.0" ||
      typeof payload.method !== "string"
    ) {
      return res.status(400).json({
        jsonrpc: "2.0",
        id: payload?.id ?? null,
        error: { code: -32600, message: "Invalid Request" }
      });
    }

    const auth = req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    const token = match?.[1];

    const role =
      token !== undefined && Object.hasOwn(tokenRoles, token)
        ? tokenRoles[token]
        : undefined;

    if (payload.method === "tools/call") {
      const toolName = payload.params?.name;

      if (typeof toolName !== "string") {
        return res.status(400).json({
          jsonrpc: "2.0",
          id: payload.id ?? null,
          error: {
            code: -32602,
            message: "Invalid params: params.name is required"
          }
        });
      }

      if (toolName.startsWith("admin_") && role !== "admin") {
        return res.status(200).json({
          jsonrpc: "2.0",
          id: payload.id ?? null,
          error: {
            code: -32001,
            message: "Unauthorized Tool Call"
          }
        });
      }

      if (!role) {
        return res.status(401).json({
          jsonrpc: "2.0",
          id: payload.id ?? null,
          error: {
            code: -32001,
            message: "Unauthorized"
          }
        });
      }
    }

    try {
      const upstream = await fetch(downstreamUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(req.header("content-type")
            ? {
                "x-original-content-type": req.header("content-type")!
              }
            : {})
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000)
      });

      res.status(upstream.status);

      const contentType = upstream.headers.get("content-type");
      if (contentType) {
        res.setHeader("content-type", contentType);
      }

      const body = await upstream.arrayBuffer();
      return res.send(Buffer.from(body));
    } catch {
      return res.status(502).json({
        jsonrpc: "2.0",
        id: payload.id ?? null,
        error: {
          code: -32000,
          message: "Downstream MCP server unavailable"
        }
      });
    }
  });

  // Handle malformed JSON and oversized request bodies.
  app.use((
    err: unknown,
    _req: Request,
    res: Response,
    _next: express.NextFunction
  ) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      type?: string;
    };

    if (error.type === "entity.parse.failed") {
      return res.status(400).json({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Parse error"
        }
      });
    }

    if (
      error.status === 413 ||
      error.statusCode === 413 ||
      error.type === "entity.too.large"
    ) {
      return res.status(413).json({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: "Request too large"
        }
      });
    }

    return res.status(500).json({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32603,
        message: "Internal gateway error"
      }
    });
  });

  return app;
}
