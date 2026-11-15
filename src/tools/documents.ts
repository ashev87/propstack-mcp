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
    fmt(d.url, "") ? `URL: ${fmt(d.url)}` : null,
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
        const raw = await client.get<{ documents: PropstackDocument[]; meta?: { total_count: number } }>(
          "/documents",
          { params: args as Record<string, string | number | boolean | undefined> },
        );
        const docs = raw.documents ?? [];

        if (docs.length === 0) {
          return textResult("No documents found.");
        }

        const header = raw.meta?.total_count !== undefined
          ? `Found ${raw.meta.total_count} documents (showing ${docs.length}):\n\n`
          : `Found ${docs.length} documents:\n\n`;

        const formatted = docs.map(formatDocument).join("\n\n---\n\n");
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
      tags: z.array(z.string()).optional()
        .describe("Document tags, e.g. ['Energieausweis']; unknown tags are created"),
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

  // ── get_document ────────────────────────────────────────────────

  server.tool(
    "get_document",
    `Get a single document's details, including its download URL and flags.

Download URLs are signed and may expire; fetch the document again rather
than storing the URL.`,
    {
      id: z.number()
        .describe("Document ID"),
    },
    async (args) => {
      try {
        const document = await client.get<PropstackDocument>(`/documents/${args.id}`);
        return textResult(formatDocument(document));
      } catch (err) {
        return errorResult("Document", err);
      }
    },
  );

  // ── update_document ─────────────────────────────────────────────

  server.tool(
    "update_document",
    `Update a document's title, tags or flags (floor plan, exposé, private,
landing page). Only provide the fields you want to change.

Setting tags replaces the document's tag list. To replace the file itself,
upload a new document and delete the old one.`,
    {
      id: z.number()
        .describe("Document ID"),
      title: z.string().optional()
        .describe("New title"),
      tags: z.array(z.string()).optional()
        .describe("New tag list (replaces existing tags; unknown tags are created)"),
      is_private: z.boolean().optional()
        .describe("Hide from portals"),
      is_floorplan: z.boolean().optional()
        .describe("Mark as floor plan (Grundriss)"),
      is_exposee: z.boolean().optional()
        .describe("Use as the PDF exposé of the property/project"),
      on_landing_page: z.boolean().optional()
        .describe("Show on the landing page"),
    },
    async (args) => {
      try {
        const { id, ...fields } = args;
        const body = stripUndefined(fields);
        if (Object.keys(body).length === 0) {
          return { ...textResult("Nothing to update: provide at least one field."), isError: true as const };
        }
        const document = await client.put<PropstackDocument>(`/documents/${id}`, {
          body: { document: body },
        });
        return textResult(`Document updated successfully.\n\n${formatDocument(document)}`);
      } catch (err) {
        return errorResult("Document", err);
      }
    },
  );

  // ── delete_document ─────────────────────────────────────────────

  server.tool(
    "delete_document",
    `Permanently delete a document. This cannot be undone.

Confirm with the user before deleting, naming the document's title.`,
    {
      id: z.number()
        .describe("Document ID to delete"),
    },
    async (args) => {
      try {
        await client.delete(`/documents/${args.id}`);
        return textResult(`Document ${args.id} deleted.`);
      } catch (err) {
        return errorResult("Document", err);
      }
    },
  );

  // ── list_document_tags ──────────────────────────────────────────

  server.tool(
    "list_document_tags",
    `List all tags in use on documents (e.g. "Energieausweis", "Grundbuch").

Use them with upload_document / update_document.`,
    {},
    async () => {
      try {
        const res = await client.get<{ data?: string[] } | string[]>("/documents/tags");
        const tags = Array.isArray(res) ? res : (res.data ?? []);
        if (tags.length === 0) return textResult("No document tags defined.");
        return textResult(`Document tags (${tags.length}):\n\n${tags.map((t) => `- ${t}`).join("\n")}`);
      } catch (err) {
        return errorResult("Document tag", err);
      }
    },
  );
}
