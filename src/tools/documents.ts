import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type { PropstackDocument, PropstackPaginatedResponse } from "../types/propstack.js";
import { textResult, errorResult, fmt, stripUndefined } from "./helpers.js";

// ── Response formatting ──────────────────────────────────────────────

function formatDocument(d: PropstackDocument): string {
  const flags: string[] = [];
  if (d.is_floorplan) flags.push("floorplan");
  if (d.is_exposee) flags.push("exposé");
  if (d.is_private) flags.push("private");
  if (d.on_landing_page) flags.push("landing page");

  const lines: (string | null)[] = [
    `**${fmt(d.title ?? d.name, "Untitled")}** (ID: ${d.id})`,
    d.url ? `URL: ${d.url}` : null,
    flags.length ? `Flags: ${flags.join(", ")}` : null,
    d.tags?.length ? `Tags: ${d.tags.join(", ")}` : null,
    d.broker_id ? `Broker ID: ${d.broker_id}` : null,
    `Created: ${fmt(d.created_at)}`,
  ];

  return lines.filter(Boolean).join("\n");
}

// ── Tool registration ────────────────────────────────────────────────

export function registerDocumentTools(server: McpServer, client: PropstackClient): void {
  // ── list_documents ──────────────────────────────────────────────

  server.tool(
    "list_documents",
    `List documents attached to a property, project, or contact.

Documents include floor plans (Grundrisse), exposés, contracts,
photos, and any other uploaded files.

Use this tool to:
- See all documents for a property ("Where's the Grundriss?")
- List a contact's uploaded files
- Find exposés or contracts for a project
- Check what's already been uploaded before adding more

Filter by exactly one of property_id, project_id, or client_id.`,
    {
      property_id: z.number().optional()
        .describe("Filter by property ID"),
      project_id: z.number().optional()
        .describe("Filter by project ID"),
      client_id: z.number().optional()
        .describe("Filter by contact ID"),
      sort: z.string().optional()
        .describe("Sort string (e.g. 'created_at,desc')"),
      page: z.number().optional()
        .describe("Page number (default: 1)"),
      per_page: z.number().optional()
        .describe("Results per page (default: 25)"),
    },
    async (args) => {
      try {
        const res = await client.get<PropstackPaginatedResponse<PropstackDocument>>(
          "/documents",
          { params: args as Record<string, string | number | boolean | undefined> },
        );

        if (!res.data || res.data.length === 0) {
          return textResult("No documents found.");
        }

        const header = res.meta?.total_count !== undefined
          ? `Found ${res.meta.total_count} documents (showing ${res.data.length}):\n\n`
          : `Found ${res.data.length} documents:\n\n`;

        const formatted = res.data.map(formatDocument).join("\n\n---\n\n");
        return textResult(header + formatted);
      } catch (err) {
        return errorResult("Document", err);
      }
    },
  );

  // ── upload_document ─────────────────────────────────────────────

  server.tool(
    "upload_document",
    `Upload a document to a property, project, or contact in Propstack.

The doc field must be a base64 data URI, e.g.:
  "data:application/pdf;base64,JVBERi0xLjQ..."
  "data:image/png;base64,iVBORw0KGgo..."

Attach to exactly one entity: property_id, project_id, or client_id.

Use the boolean flags to classify the document:
- is_floorplan: Mark as a floor plan (Grundriss)
- is_exposee: Mark as an exposé document
- is_private: Hide from public/portal views
- on_landing_page: Show on the property landing page`,
    {
      title: z.string()
        .describe("Document title"),
      doc: z.string()
        .describe("Base64 data URI (e.g. 'data:application/pdf;base64,...')"),
      property_id: z.number().optional()
        .describe("Attach to this property"),
      project_id: z.number().optional()
        .describe("Attach to this project"),
      client_id: z.number().optional()
        .describe("Attach to this contact"),
      is_private: z.boolean().optional()
        .describe("Mark as private (hidden from portals)"),
      is_floorplan: z.boolean().optional()
        .describe("Mark as floor plan (Grundriss)"),
      is_exposee: z.boolean().optional()
        .describe("Mark as exposé document"),
      on_landing_page: z.boolean().optional()
        .describe("Show on property landing page"),
    },
    async (args) => {
      try {
        const document = await client.post<PropstackDocument>(
          "/documents",
          { body: { document: stripUndefined(args) } },
        );

        return textResult(`Document uploaded successfully.\n\n${formatDocument(document)}`);
      } catch (err) {
        return errorResult("Document", err);
      }
    },
  );
}
