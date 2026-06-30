import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type { PropstackWebhook, PropstackProperty } from "../types/propstack.js";
import { textResult, errorResult, fmt, fmtPrice } from "./helpers.js";

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
        const raw = await client.get<{ hooks: PropstackWebhook[] } | PropstackWebhook[]>("/hooks");
        const hooks = Array.isArray(raw) ? raw : raw?.hooks ?? [];

        if (hooks.length === 0) {
          return textResult("No webhooks configured.");
        }

        const lines = hooks.map((h) => {
          const parts: (string | null)[] = [
            `**Webhook #${h.id}**`,
            `  URL: ${fmt(h.target_url)}`,
            `  Event: ${fmt(h.event)}`,
            `  Active: ${h.active !== false ? "yes" : "no"}`,
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
          `URL: ${fmt(hook.target_url)}`,
          `Event: ${fmt(hook.event, args.event)}`,
          `Active: ${hook.active !== false ? "yes" : "no"}`,
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
          const addr = [fmt(p.street, ""), fmt(p.house_number, "")].filter(Boolean).join(" ");
          const city = [fmt(p.zip_code, ""), fmt(p.city, "")].filter(Boolean).join(" ");
          const fullAddr = [addr, city].filter(Boolean).join(", ");
          const price = fmtPrice(p.price) !== "none"
            ? fmtPrice(p.price)
            : fmtPrice(p.base_rent) !== "none"
              ? fmtPrice(p.base_rent) + "/mo"
              : "no price";
          return `- **${fmt(p.title, "Untitled")}** (ID: ${p.id}) — ${fullAddr || "no address"} — ${price}`;
        });

        return textResult(`Favorited properties (${favorites.length}):\n\n${lines.join("\n")}`);
      } catch (err) {
        return errorResult("Contact favorites", err);
      }
    },
  );
}
