import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach
} from "vitest";

import express from "express";
import request from "supertest";
import type { Server } from "node:http";

import { createMcpGateway } from "../src/task2/gateway.js";

describe("Task 2 - MCP Security Gateway", () => {
  const downstream = express();
  downstream.use(express.json());

  let downstreamServer: Server;
  let downstreamUrl: string;
  let downstreamHits = 0;

  let gateway: express.Express;

  beforeAll(async () => {
    downstream.post("/rpc", (req, res) => {
      downstreamHits++;

      res.json({
        jsonrpc: "2.0",
        id: req.body.id ?? null,
        result: {
          forwarded: true,
          method: req.body.method
        }
      });
    });

    downstreamServer = await new Promise<Server>((resolve) => {
      const server = downstream.listen(0, "127.0.0.1", () => {
        resolve(server);
      });
    });

    const address = downstreamServer.address();

    if (!address || typeof address === "string") {
      throw new Error("Could not determine downstream server address");
    }

    downstreamUrl = `http://127.0.0.1:${address.port}/rpc`;

    gateway = createMcpGateway({ downstreamUrl });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      downstreamServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

  beforeEach(() => {
    downstreamHits = 0;
  });

  // Test 1: Admin can call administrative tools.
  it("allows admin to call administrative tools", async () => {
    const response = await request(gateway)
      .post("/rpc")
      .set("Authorization", "Bearer admin-token")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "admin_reset_key",
          arguments: {}
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.result.forwarded).toBe(true);
    expect(downstreamHits).toBe(1);
  });

  // Test 2: Viewer cannot call administrative tools.
  it("blocks viewer from administrative tools", async () => {
    const response = await request(gateway)
      .post("/rpc")
      .set("Authorization", "Bearer viewer-token")
      .send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "admin_reset_key",
          arguments: {}
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.error.code).toBe(-32001);
    expect(downstreamHits).toBe(0);
  });

  // Test 3: Viewer can call ordinary tools.
  it("allows viewer to call ordinary tools", async () => {
    const response = await request(gateway)
      .post("/rpc")
      .set("Authorization", "Bearer viewer-token")
      .send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "get_customer_record",
          arguments: {}
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.result.forwarded).toBe(true);
    expect(downstreamHits).toBe(1);
  });

  // Test 4: tools/list is forwarded transparently.
  it("forwards tools/list transparently", async () => {
    const payload = {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/list",
      params: {}
    };

    const response = await request(gateway)
      .post("/rpc")
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.result.forwarded).toBe(true);
    expect(downstreamHits).toBe(1);
  });

  // Test 5: Missing authentication is rejected.
  it("rejects tools/call without authentication", async () => {
    const response = await request(gateway)
      .post("/rpc")
      .send({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "get_customer_record",
          arguments: {}
        }
      });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe(-32001);
    expect(downstreamHits).toBe(0);
  });

  // Test 6: Invalid JSON-RPC requests are rejected.
  it("rejects invalid JSON-RPC requests", async () => {
    const response = await request(gateway)
      .post("/rpc")
      .send({
        jsonrpc: "1.0",
        id: 6,
        method: "tools/list"
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(-32600);
    expect(downstreamHits).toBe(0);
  });

  // Test 7: Malformed Bearer authorization headers are rejected.
  it("rejects malformed Bearer authorization headers", async () => {
    const response = await request(gateway)
      .post("/rpc")
      .set("Authorization", "Basic viewer-token")
      .send({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "get_customer_record",
          arguments: {}
        }
      });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe(-32001);
    expect(downstreamHits).toBe(0);
  });

  // Test 8: Downstream server failures return a standardized error.
  it("returns a JSON-RPC error when the downstream server is unavailable", async () => {
    const unavailableGateway = createMcpGateway({
      downstreamUrl: "http://127.0.0.1:1/rpc"
    });

    const response = await request(unavailableGateway)
      .post("/rpc")
      .set("Authorization", "Bearer viewer-token")
      .send({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "get_customer_record",
          arguments: {}
        }
      });

    expect(response.status).toBe(502);
    expect(response.body.jsonrpc).toBe("2.0");
    expect(response.body.error.code).toBe(-32000);
    expect(response.body.error.message).toBe(
      "Downstream MCP server unavailable"
    );
  });
  it("rejects inherited object property names as invalid tokens", async () => {
  const response = await request(gateway)
    .post("/rpc")
    .set("Authorization", "Bearer toString")
    .send({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "get_customer_record",
        arguments: {}
      }
    });

  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe(-32001);
  expect(downstreamHits).toBe(0);
});
it("returns a JSON-RPC parse error for malformed JSON", async () => {
  const response = await request(gateway)
    .post("/rpc")
    .set("Content-Type", "application/json")
    .send('{"jsonrpc":"2.0",');

  expect(response.status).toBe(400);
  expect(response.body.jsonrpc).toBe("2.0");
  expect(response.body.id).toBeNull();
  expect(response.body.error.code).toBe(-32700);
  expect(response.body.error.message).toBe("Parse error");
  expect(downstreamHits).toBe(0);
});
});