#!/usr/bin/env node

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PropstackClient } from "./propstack-client.js";
import { registerContactTools } from "./tools/contacts.js";
import { registerPropertyTools } from "./tools/properties.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerDealTools } from "./tools/deals.js";
import { registerSearchProfileTools } from "./tools/search-profiles.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerActivityTools } from "./tools/activities.js";
import { registerEmailTools } from "./tools/emails.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerRelationshipTools } from "./tools/relationships.js";
import { registerLookupTools } from "./tools/lookups.js";
import { registerCompositeTools } from "./tools/composites.js";
import { registerAdminTools } from "./tools/admin.js";

const PROPSTACK_API_KEY = process.env["PROPSTACK_API_KEY"];

if (!PROPSTACK_API_KEY) {
  console.error("Error: PROPSTACK_API_KEY environment variable is required");
  process.exit(1);
}

const client = new PropstackClient(PROPSTACK_API_KEY);

const server = new McpServer(
  {
    name: "propstack-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

registerContactTools(server, client);
registerPropertyTools(server, client);
registerTaskTools(server, client);
registerDealTools(server, client);
registerSearchProfileTools(server, client);
registerProjectTools(server, client);
registerActivityTools(server, client);
registerEmailTools(server, client);
registerDocumentTools(server, client);
registerRelationshipTools(server, client);
registerLookupTools(server, client);
registerCompositeTools(server, client);
registerAdminTools(server, client);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Propstack MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
