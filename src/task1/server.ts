
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Strict customer ID validation: CUST- followed by exactly 5 digits.
const customerIdSchema = z
  .string()
  .regex(/^CUST-\d{5}$/, "customer_id must match CUST-XXXXX");

// Strict input schemas reject unexpected properties.
const getCustomerRecordSchema = z.object({
  customer_id: customerIdSchema
}).strict();

const triggerRefundSchema = z.object({
  customer_id: customerIdSchema,
  amount: z.number().finite().positive(),
  reason: z.string().trim().min(
    10,
    "reason must contain at least 10 characters"
  )
}).strict();

const server = new McpServer({
  name: "quilrai-customer-tools",
  version: "1.0.0"
});

// In-memory fixtures keep this assessment self-contained.
// Replace with a real data layer in production.
const customers = new Map([
  [
    "CUST-12345",
    {
      customer_id: "CUST-12345",
      name: "Alex Morgan",
      status: "active",
      tier: "gold"
    }
  ],
  [
    "CUST-67890",
    {
      customer_id: "CUST-67890",
      name: "Jordan Lee",
      status: "active",
      tier: "standard"
    }
  ]
]);

// Tool 1: Retrieve customer record.
server.registerTool(
  "get_customer_record",
  {
    description:
      "Retrieve a customer record by its CUST-XXXXX identifier.",
    inputSchema: getCustomerRecordSchema
  },
  async ({ customer_id }) => {
    const customer = customers.get(customer_id);

    if (!customer) {
      return {
        content: [
          {
            type: "text",
            text: `Customer ${customer_id} was not found.`
          }
        ],
        isError: true
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(customer)
        }
      ]
    };
  }
);

// Tool 2: Validate and simulate refund request.
server.registerTool(
  "trigger_refund",
  {
    description:
      "Validate and simulate a refund request. This assessment implementation does not move money.",
    inputSchema: triggerRefundSchema
  },
  async ({ customer_id, amount, reason }) => {
    if (!customers.has(customer_id)) {
      return {
        content: [
          {
            type: "text",
            text: `Customer ${customer_id} was not found; no refund was created.`
          }
        ],
        isError: true
      };
    }

    const result = {
      status: "accepted_for_review",
      customer_id,
      amount,
      reason,
      refund_id: `RF-${Date.now()}`
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result)
        }
      ]
    };
  }
);

// Start MCP server using stdio transport.
async function main() {
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // stdout is exclusively reserved for MCP JSON-RPC messages.
  console.error("QuilrAI customer MCP server running on stdio");
}

main().catch((error: unknown) => {
  console.error("MCP server startup failed:", error);
  process.exitCode = 1;
});
