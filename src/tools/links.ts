import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import { textResult, errorResult, fmt, stripUndefined } from "./helpers.js";

interface PropstackLink {
  id: number;
  title: string | null;
  url: string | null;
  is_private: boolean | null;
  is_embedable: boolean | null;
  on_landing_page: boolean | null;
  position: number | null;
}

function formatLink(l: PropstackLink): string {
  const flags: string[] = [];
  if (l.is_private) flags.push("private (not on portals)");
  if (l.is_embedable) flags.push("embedded as iframe");
  if (l.on_landing_page) flags.push("on landing page");
  return `**${fmt(l.title, "Untitled")}** (ID: ${l.id})\nURL: ${fmt(l.url)}` +
    (flags.length ? `\nFlags: ${flags.join(", ")}` : "");
}

const linkFields = {
  title: z.string().optional()
    .describe("Link title"),
  url: z.string().optional()
    .describe("Link URL (e.g. virtual tour, video)"),
  is_private: z.boolean().optional()
    .describe("true = do not transfer the link to portals"),
  is_embedable: z.boolean().optional()
    .describe("true = embed as iframe on the property landing page"),
  on_landing_page: z.boolean().optional()
    .describe("true = show the link on the property landing page"),
};

// ── Tool registration ────────────────────────────────────────────────

export function registerLinkTools(server: McpServer, client: PropstackClient): void {
  // ── create_property_link ────────────────────────────────────────

  server.tool(
    "create_property_link",
    `Add a link to a property, e.g. a 360° virtual tour, video or website.

Links can be transferred to portals and shown on the property landing page.
Existing links are listed by get_property.`,
    {
      property_id: z.number()
        .describe("Property ID"),
      ...linkFields,
      title: z.string()
        .describe("Link title"),
      url: z.string()
        .describe("Link URL (e.g. virtual tour, video)"),
    },
    async (args) => {
      try {
        const { property_id, ...fields } = args;
        const link = await client.post<PropstackLink>("/links", {
          body: { property_id, link: stripUndefined(fields) },
        });
        return textResult(`Link added to property ${property_id}.\n\n${formatLink(link)}`);
      } catch (err) {
        return errorResult("Link", err);
      }
    },
  );

  // ── update_property_link ────────────────────────────────────────

  server.tool(
    "update_property_link",
    `Update a property link. Only provide the fields you want to change.`,
    {
      id: z.number()
        .describe("Link ID"),
      ...linkFields,
    },
    async (args) => {
      try {
        const { id, ...fields } = args;
        const link = stripUndefined(fields);
        if (Object.keys(link).length === 0) {
          return { ...textResult("Nothing to update: provide at least one field."), isError: true as const };
        }
        const updated = await client.put<PropstackLink>(`/links/${id}`, { body: { link } });
        return textResult(`Link updated.\n\n${formatLink(updated)}`);
      } catch (err) {
        return errorResult("Link", err);
      }
    },
  );

  // ── delete_property_link ────────────────────────────────────────

  server.tool(
    "delete_property_link",
    `Delete a link from a property. This cannot be undone.`,
    {
      id: z.number()
        .describe("Link ID"),
    },
    async (args) => {
      try {
        await client.delete(`/links/${args.id}`);
        return textResult(`Link ${args.id} deleted.`);
      } catch (err) {
        return errorResult("Link", err);
      }
    },
  );
}
