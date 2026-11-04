import "dotenv/config";
import { createLlmGateway } from "./gateway.js";
const port = Number(process.env.LLM_GATEWAY_PORT ?? 3002);
const providerUrl = process.env.LLM_PROVIDER_URL ?? "https://api.openai.com/v1/chat/completions";
createLlmGateway({ providerUrl, apiKey: process.env.LLM_API_KEY, model: process.env.PRIMARY_MODEL }).listen(port, () => console.error(`LLM streaming gateway listening on ${port}`));
