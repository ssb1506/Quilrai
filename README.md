# QuilrAI — AI Field Developer Technical Assessment

A TypeScript/Node.js implementation of the four tasks in the QuilrAI AI Field Developer technical assessment.

## Requirements

- Node.js 20+
- npm 10+
- An OpenAI-compatible provider endpoint and API key for live LLM calls (Tasks 3 and 4)

## Installation and setup

```bash
npm install
cp .env.example .env
```

Configure `.env` with your provider credentials and model settings.

Build and run the tests:

```bash
npm run build
npm test
npm audit
```

## Running the four tasks

Each task runs independently.

```bash
npm run dev:task1
npm run dev:task2
npm run dev:task3
npm run dev:task4
```

| Task | Component | Default endpoint |
|---|---|---|
| 1 | Customer MCP server | stdio |
| 2 | MCP security gateway | http://localhost:3001/rpc |
| 3 | LLM streaming guardrail | http://localhost:3002/v1/generate |
| 4 | Token limiter and model router | http://localhost:3003/v1/completions |

## Task 1 — Custom MCP server

Uses the official Model Context Protocol TypeScript SDK and Zod validation schemas.

Implemented tools:

- `get_customer_record(customer_id)`
- `trigger_refund(customer_id, amount, reason)`

Validation includes:

- Customer IDs must match `CUST-XXXXX`.
- Refund amounts must be finite and positive.
- Refund reasons must contain at least 10 characters.
- Unexpected input properties are rejected through strict schemas.

The server uses stdio transport. Diagnostic messages are written to stderr, leaving stdout for MCP protocol traffic.

Refund operations are simulated and do not move money.

## Task 2 — MCP security gateway

The HTTP gateway accepts JSON-RPC requests at `POST /rpc` and forwards permitted requests to the configured downstream MCP server.

Authorization behavior:

- `tools/list` is forwarded transparently.
- `tools/call` requires a recognized Bearer token.
- Administrative tools whose names start with `admin_` require the admin role.
- Unauthorized administrative calls return JSON-RPC error `-32001` without contacting the downstream server.

Development tokens:

- `admin-token`
- `viewer-token`

These are demonstration credentials, not production authentication.

Production hardening should include verified JWT/OIDC claims or token introspection, TLS, audit logging, request IDs, and explicit tool allowlists.

## Task 3 — LLM streaming PII guardrail

The gateway accepts prompts at `POST /v1/generate`.

It sends requests to an OpenAI-compatible chat-completions endpoint with streaming enabled.

The SSE parser extracts `choices[0].delta.content` from provider events.

The streaming redactor detects and replaces:

- Email addresses
- US Social Security Numbers in `123-45-6789` format
- Card-like numeric sequences containing 13–19 digits

Sensitive values are replaced with `[REDACTED]`.

The redactor uses a bounded 320-character holdback to help detect supported patterns split across incoming chunks. It emits safe text incrementally when sufficient text is available, and the gateway handles response backpressure.

The client receives guarded generated text as a `text/plain` stream.

Limitations and production considerations:

- Pattern-based detection does not guarantee detection of every possible PII representation.
- Card-like numeric detection can produce false positives; a vetted payment-card detector and Luhn validation may improve precision.
- The holdback introduces a latency trade-off, particularly for short responses.
- Provider-specific SSE formats require corresponding parsers and tests.
- Real network time-to-first-token benchmarking remains a separate performance validation step.

## Task 4 — Token limiter and fallback router

The HTTP gateway accepts requests at `POST /v1/completions`.

It requires the `x-tenant-api-key` header.

Rate limiting:

- Default quota: 50,000 tokens per tenant.
- Default rolling window: 60 seconds.
- SQLite stores token reservations and timestamps.
- An indexed sliding-window query calculates current usage.
- A transaction performs cleanup, usage calculation, and reservation atomically.
- Tenant API keys are SHA-256 hashed before storage.

Model routing:



- The primary model is attempted first using the primary provider endpoint and API key.
- The configured backup model is sent to a separate backup provider endpoint using its own API key.
- The backup provider is attempted after primary HTTP 429, timeout, network failure, or upstream 5xx.
- The default timeout per provider attempt is 3,000 milliseconds.
- Client-facing errors are sanitized.

Token accounting limitation:

The gateway reserves the requested `max_tokens` value, defaulting to 1,000, before dispatch. This is a conservative reservation approach, not actual provider-reported token usage. Production systems should reconcile reservations with actual usage and define how failed or cancelled requests affect quota accounting.


## Environment configuration

Copy `.env.example` to `.env` and configure the required values.

- `MCP_DOWNSTREAM_URL`: Downstream MCP server URL for Task 2.
- `LLM_PROVIDER_URL` and `LLM_API_KEY`: Primary LLM provider endpoint and API key.
- `PRIMARY_MODEL`: Primary model name.
- `BACKUP_PROVIDER_URL` and `BACKUP_API_KEY`: Separate backup provider endpoint and API key for Task 4.
- `BACKUP_MODEL`: Backup model name.
- `SQLITE_PATH`: SQLite database path for token usage.
- Port variables configure the individual task servers.

The primary and backup endpoints must support the request format expected by the gateway.

Do not commit `.env` or actual API keys. Configure real provider credentials locally before running live provider requests.

## Example requests

### Task 2 — MCP security gateway

```bash
curl -i http://localhost:3001/rpc \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer viewer-token' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"admin_reset_key","arguments":{}}}'
```

Expected: HTTP 200 with JSON-RPC error `-32001`.

### Task 3 — Streaming generation

```bash
curl -N http://localhost:3002/v1/generate \
  -H 'content-type: application/json' \
  -d '{"prompt":"Return a short greeting"}'
```

### Task 4 — Model gateway

```bash
curl -i http://localhost:3003/v1/completions \
  -H 'content-type: application/json' \
  -H 'x-tenant-api-key: tenant-demo' \
  -d '{"messages":[{"role":"user","content":"Hello"}],"max_tokens":1000}'
```

## Testing

Run the complete automated test suite:

```bash
npm test
```

The test suite covers:

- MCP gateway authorization and forwarding.
- Streaming PII redaction and chunk-boundary behavior.
- LLM gateway request handling and sanitized errors.
- Streaming output before the source finishes.
- Sliding-window quota enforcement and tenant isolation.
- SQLite persistence across database reopen.
- Primary-to-backup model failover.
- HTTP gateway validation and error handling.

Also run:

```bash
npm run build
npm audit
```

## Security and production considerations

- Replace demonstration MCP credentials with verified authentication.
- Use TLS for external traffic.
- Store secrets in a secure secret manager.
- Add audit logging and request correlation IDs.
- Consider provider-specific PII detection and additional redaction tests.
- Reconcile token reservations with actual provider usage.
- Test concurrent requests and real network streaming performance before production deployment.

## Project structure

```text
src/
  task1/
    server.ts
  task2/
    gateway.ts
    server.ts
  task3/
    gateway.ts
    redactor.ts
    sse.ts
    server.ts
  task4/
    app.ts
    modelRouter.ts
    rateLimiter.ts
    server.ts

test/
  modelRouter.test.ts
  rateLimiter.test.ts
  redactor.test.ts
  task2.gateway.test.ts
  task3.gateway.test.ts
  task3.streaming.test.ts
  task4.server.test.ts
```
