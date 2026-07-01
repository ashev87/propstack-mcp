#!/usr/bin/env node

import "dotenv/config";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PropstackClient } from "./propstack-client.js";

// Single source of truth for the version advertised to MCP clients.
const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };
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

// The key is optional at startup so the server can boot and advertise its
// tools even when no key is configured. This is required by MCP registry
// scanners (e.g. Glama), which launch the server and call `tools/list`
// without any secrets. A missing key only fails at request time, where it
// surfaces as a clear "Invalid API key" tool error instead of crashing the
// whole process on boot.
const PROPSTACK_API_KEY = process.env["PROPSTACK_API_KEY"] ?? "";

if (!PROPSTACK_API_KEY) {
  console.error(
    "Warning: PROPSTACK_API_KEY is not set. The server will start and expose " +
      "its tools, but every tool call will fail until you configure the key.",
  );
}

const client = new PropstackClient(PROPSTACK_API_KEY);

const server = new McpServer(
  {
    name: "propstack-mcp-server",
    version,
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
