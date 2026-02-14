import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type { PropstackRelationship } from "../types/propstack.js";
import { textResult, errorResult } from "./helpers.js";

// ── Tool registration ────────────────────────────────────────────────

export function registerRelationshipTools(server: McpServer, client: PropstackClient): void {
  // ── create_ownership ────────────────────────────────────────────

  server.tool(
    "create_ownership",
    `Link a contact as the OWNER (Eigentümer) of a property.

Use this tool to:
- Record property ownership ("Herr Müller owns Hauptstraße 12")
- Set up owner relationships for acquisition properties
- Link sellers to their properties

The ownership appears on both the contact's and the property's record.`,
    {
      client_id: z.number()
        .describe("Contact ID (the owner)"),
      property_id: z.number()
        .describe("Property ID (the owned property)"),
    },
    async (args) => {
      try {
        const rel = await client.post<PropstackRelationship>(
          "/ownerships",
          { body: args },
        );

        return textResult(
          `Ownership created (ID: ${rel.id}).\n` +
          `Contact ${rel.client_id} is now owner of property ${rel.property_id}.`,
        );
      } catch (err) {
        return errorResult("Ownership", err);
      }
    },
  );

  // ── create_partnership ──────────────────────────────────────────

  server.tool(
    "create_partnership",
    `Link a contact as a PARTNER (buyer, tenant, etc.) to a property.

Use this tool to:
- Link a buyer to a property ("Frau Schmidt is the buyer of Hauptstraße 12")
- Link a tenant to a rental property
- Create any named contact↔property relationship

The name field describes the role (e.g. "Käufer", "Mieter", "Verwalter").`,
    {
      client_id: z.number()
        .describe("Contact ID (the partner)"),
      property_id: z.number()
        .describe("Property ID"),
      name: z.string().optional()
        .describe("Role name (e.g. 'Käufer', 'Mieter', 'Verwalter')"),
    },
    async (args) => {
      try {
        const rel = await client.post<PropstackRelationship>(
          "/partnerships",
          { body: args },
        );

        const role = rel.name ? ` as "${rel.name}"` : "";
        return textResult(
          `Partnership created (ID: ${rel.id}).\n` +
          `Contact ${rel.client_id} linked to property ${rel.property_id}${role}.`,
        );
      } catch (err) {
        return errorResult("Partnership", err);
      }
    },
  );
}
