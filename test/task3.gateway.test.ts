import {
  describe,
  it,
  expect,
  vi,
  afterEach
} from "vitest";

import express from "express";
import request from "supertest";

import { createLlmGateway } from "../src/task3/gateway.js";

function createSseResponse(text: string, status = 200): Response {
  const events = [
    `data: ${JSON.stringify({
      choices: [{ delta: { content: text } }]
    })}\n\n`,
    "data: [DONE]\n\n"
  ];

  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(new TextEncoder().encode(event));
        }

        controller.close();
      }
    }),
    {
      status,
      headers: {
        "content-type": "text/event-stream"
      }
    }
  );
}

describe("Task 3 - LLM Streaming Gateway", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects requests without a prompt", async () => {
    const gateway = createLlmGateway({
      providerUrl: "http://localhost:9999"
    });

    const response = await request(gateway)
      .post("/v1/generate")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_request");
  });

  it("forwards the prompt and provider API key", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        createSseResponse("Hello from the model")
      );

    const gateway = createLlmGateway({
      providerUrl: "http://provider.test/v1/chat/completions",
      apiKey: "test-api-key",
      model: "gpt-4o-mini"
    });

    const response = await request(gateway)
      .post("/v1/generate")
      .send({ prompt: "Say hello" });

    expect(response.status).toBe(200);
    expect(response.text).toContain("Hello from the model");

    const [url, options] = fetchMock.mock.calls[0];

    expect(url).toBe(
      "http://provider.test/v1/chat/completions"
    );

    expect(options?.headers).toMatchObject({
      authorization: "Bearer test-api-key"
    });

    const body = JSON.parse(options?.body as string);

    expect(body.model).toBe("gpt-4o-mini");
    expect(body.stream).toBe(true);
    expect(body.messages[0].content).toBe("Say hello");
  });

  it("redacts PII before sending the response to the client", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      createSseResponse(
        "Contact jane.doe@example.com. SSN 123-45-6789."
      )
    );

    const gateway = createLlmGateway({
      providerUrl: "http://provider.test"
    });

    const response = await request(gateway)
      .post("/v1/generate")
      .send({ prompt: "Return contact information" });

    expect(response.status).toBe(200);
    expect(response.text).not.toContain("jane.doe@example.com");
    expect(response.text).not.toContain("123-45-6789");
    expect(response.text).toContain("[REDACTED]");
  });

  it("returns a sanitized error when the provider responds unsuccessfully", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Sensitive provider error details", {
        status: 429
      })
    );

    const gateway = createLlmGateway({
      providerUrl: "http://provider.test"
    });

    const response = await request(gateway)
      .post("/v1/generate")
      .send({ prompt: "Hello" });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("upstream_error");
    expect(response.text).not.toContain(
      "Sensitive provider error details"
    );
  });

  it("returns a sanitized error when the provider request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Internal provider connection details")
    );

    const gateway = createLlmGateway({
      providerUrl: "http://provider.test"
    });

    const response = await request(gateway)
      .post("/v1/generate")
      .send({ prompt: "Hello" });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("gateway_error");
    expect(response.text).not.toContain(
      "Internal provider connection details"
    );
  });
});