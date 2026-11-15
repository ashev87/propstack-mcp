#!/usr/bin/env node

import "dotenv/config";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PropstackClient, V2_BASE } from "./propstack-client.js";

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
import { registerImageTools } from "./tools/images.js";
import { registerAdminTools } from "./tools/admin.js";
import { registerPortalTools } from "./tools/portals.js";
import { registerLinkTools } from "./tools/links.js";

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

// API V2 is used only for the few endpoints V1 does not offer (image delete
// and sort, portal list). Propstack can issue separate V2 keys; fall back to
// the V1 key, which works when the key has V2 access.
const PROPSTACK_API_KEY_V2 = process.env["PROPSTACK_API_KEY_V2"] || PROPSTACK_API_KEY;
const clientV2 = new PropstackClient(
  PROPSTACK_API_KEY_V2,
  V2_BASE,
  process.env["PROPSTACK_API_KEY_V2"] ? "PROPSTACK_API_KEY_V2" : "PROPSTACK_API_KEY",
);

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
registerImageTools(server, client, clientV2);
registerRelationshipTools(server, client);
registerLookupTools(server, client);
registerCompositeTools(server, client);
registerAdminTools(server, client);
registerPortalTools(server, client, clientV2);
registerLinkTools(server, client);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Propstack MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
