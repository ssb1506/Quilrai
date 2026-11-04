import "dotenv/config";
import { createMcpGateway } from "./gateway.js";
const port = Number(process.env.MCP_GATEWAY_PORT ?? 3001);
const downstreamUrl = process.env.MCP_DOWNSTREAM_URL ?? "http://localhost:4000/rpc";
createMcpGateway({ downstreamUrl }).listen(port, () => console.error(`MCP security gateway listening on ${port}`));
