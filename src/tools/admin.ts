import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type { PropstackWebhook, PropstackProperty } from "../types/propstack.js";
import { textResult, errorResult, fmt } from "./helpers.js";

// ── Tool registration ────────────────────────────────────────────────

export function registerAdminTools(server: McpServer, client: PropstackClient): void {
  // ── list_webhooks ───────────────────────────────────────────────

  server.tool(
    "list_webhooks",
    `List all configured webhooks in Propstack.

Returns each webhook with its URL, subscribed events, active status,
and HMAC secret. Use to review existing automation triggers.`,
    {},
    async () => {
      try {
        const hooks = await client.get<PropstackWebhook[]>("/hooks");

        if (!hooks || hooks.length === 0) {
          return textResult("No webhooks configured.");
        }

        const lines = hooks.map((h) => {
          const parts: (string | null)[] = [
            `**Webhook #${h.id}**`,
            `  URL: ${fmt(h.url)}`,
            `  Events: ${h.events?.join(", ") ?? "none"}`,
            `  Active: ${h.active ? "yes" : "no"}`,
            h.secret ? `  Secret: ${h.secret}` : null,
          ];
          return parts.filter(Boolean).join("\n");
        });

        return textResult(`Webhooks:\n\n${lines.join("\n\n")}`);
      } catch (err) {
        return errorResult("Webhook", err);
      }
    },
  );

  // ── create_webhook ──────────────────────────────────────────────

  server.tool(
    "create_webhook",
    `Create a webhook to subscribe to Propstack CRM events.

Propstack will POST a JSON payload to target_url whenever the event
fires. Use HMAC verification (secret in response) to validate payloads.

Common events:
- CLIENT_CREATED — new contact added
- CLIENT_UPDATED — contact details changed
- PROPERTY_UPDATED — property details or status changed

Use this to set up automation triggers, e.g.:
"Notify me when any property status changes"
"Alert when a new contact is created"`,
    {
      event: z.string()
        .describe("Event name (e.g. 'CLIENT_CREATED', 'CLIENT_UPDATED', 'PROPERTY_UPDATED')"),
      target_url: z.string()
        .describe("URL that Propstack will POST to when the event fires"),
    },
    async (args) => {
      try {
        const hook = await client.post<PropstackWebhook>(
          "/hooks",
          { body: { event: args.event, target_url: args.target_url } },
        );

        const lines: (string | null)[] = [
          `Webhook created (ID: ${hook.id}).`,
          `URL: ${fmt(hook.url)}`,
          `Events: ${hook.events?.join(", ") ?? args.event}`,
          `Active: ${hook.active ? "yes" : "no"}`,
          hook.secret ? `HMAC Secret: ${hook.secret}` : null,
        ];

        return textResult(lines.filter(Boolean).join("\n"));
      } catch (err) {
        return errorResult("Webhook", err);
      }
    },
  );

  // ── delete_webhook ──────────────────────────────────────────────

  server.tool(
    "delete_webhook",
    `Delete a webhook subscription from Propstack.

Removes the webhook so Propstack will stop sending events to its URL.`,
    {
      id: z.number()
        .describe("Webhook ID to delete"),
    },
    async (args) => {
      try {
        await client.delete(`/hooks/${args.id}`);
        return textResult(`Webhook ${args.id} deleted.`);
      } catch (err) {
        return errorResult("Webhook", err);
      }
    },
  );

  // ── export_data ─────────────────────────────────────────────────

  server.tool(
    "export_data",
    `Bulk export an entire data table from Propstack as JSON.

Useful for reporting, backup, migration, or analytics. Returns the
full contents of the selected table.

Available tables:
- Core: contacts, properties, projects, deals, saved_queries
- Activities: appointments, todos, notes, messages, cancelations
- Media: documents, images
- Organization: brokers, teams, departments, commission_splits
- Config: deal_pipelines, policies, relationships, property_details
- Lookup: groups, contact_sources, contact_reasons, contact_statuses,
  reservation_reasons, property_statuses`,
    {
      table: z.enum([
        "appointments", "brokers", "cancelations", "commission_splits",
        "contacts", "deal_pipelines", "deals", "departments",
        "documents", "images", "messages", "notes",
        "policies", "projects", "properties", "property_details",
        "relationships", "saved_queries", "teams", "todos",
        "groups", "contact_sources", "contact_reasons", "contact_statuses",
        "reservation_reasons", "property_statuses",
      ])
        .describe("Table name to export"),
    },
    async (args) => {
      try {
        const data = await client.get<unknown>(
          `/datadump/${args.table}`,
        );

        if (Array.isArray(data)) {
          return textResult(`Exported ${data.length} rows from "${args.table}".\n\n${JSON.stringify(data, null, 2)}`);
        }

        return textResult(`Export of "${args.table}":\n\n${JSON.stringify(data, null, 2)}`);
      } catch (err) {
        return errorResult("Data export", err);
      }
    },
  );

  // ── get_contact_favorites ───────────────────────────────────────

  server.tool(
    "get_contact_favorites",
    `Get properties that a contact has favorited/bookmarked.

Returns the list of properties the contact has marked as favorites
in Propstack. Use to understand which listings a buyer is most
interested in.`,
    {
      contact_id: z.number()
        .describe("Contact ID"),
    },
    async (args) => {
      try {
        const favorites = await client.get<PropstackProperty[]>(
          `/contacts/${args.contact_id}/favorites`,
        );

        if (!favorites || favorites.length === 0) {
          return textResult(`Contact ${args.contact_id} has no favorited properties.`);
        }

        const lines = favorites.map((p) => {
          const addr = [p.street, p.house_number].filter(Boolean).join(" ");
          const city = [p.zip_code, p.city].filter(Boolean).join(" ");
          const fullAddr = [addr, city].filter(Boolean).join(", ");
          const price = p.price
            ? p.price.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
            : (p.base_rent
              ? `${p.base_rent.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}/mo`
              : "no price");
          return `- **${fmt(p.title, "Untitled")}** (ID: ${p.id}) — ${fullAddr || "no address"} — ${price}`;
        });

        return textResult(`Favorited properties (${favorites.length}):\n\n${lines.join("\n")}`);
      } catch (err) {
        return errorResult("Contact favorites", err);
      }
    },
  );
}
