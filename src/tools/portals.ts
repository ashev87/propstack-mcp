import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import { textResult, errorResult, fmt } from "./helpers.js";

interface PropstackPortal {
  id: number;
  name: string | null;
  /** V2 returns the format as an enum label (e.g. "IS24") or a [label, code] pair. */
  format: unknown;
  vendor_nr?: string | null;
}

function portalFormat(format: unknown): string {
  if (Array.isArray(format)) return fmt(format[0]);
  return fmt(format);
}

// ── Tool registration ────────────────────────────────────────────────

export function registerPortalTools(
  server: McpServer,
  client: PropstackClient,
  clientV2: PropstackClient,
): void {
  // ── list_portals ────────────────────────────────────────────────

  server.tool(
    "list_portals",
    `List the portal connections (ImmoScout24, OpenImmo portals, Idealista, …)
configured in this Propstack account.

Use the IDs with publish_to_portals. Uses Propstack API V2.`,
    {},
    async () => {
      try {
        const res = await clientV2.get<{ data?: PropstackPortal[] }>("/portals", {
          params: { per: 1000 },
        });
        const portals = res.data ?? [];
        if (portals.length === 0) {
          return textResult("No portal connections configured.");
        }
        const rows = portals.map(
          (p) => `| ${p.id} | ${fmt(p.name, "Unnamed")} | ${portalFormat(p.format)} |`,
        );
        return textResult(
          `# Portals (${portals.length})\n\n| ID | Name | Format |\n|---|---|---|\n${rows.join("\n")}`,
        );
      } catch (err) {
        return errorResult("Portal", err);
      }
    },
  );

  // ── publish_to_portals ──────────────────────────────────────────

  server.tool(
    "publish_to_portals",
    `Publish properties to real-estate portals, or take them offline.

active: true (default) = publish/update the listings on the given portals.
active: false = remove the listings from those portals.
is24_delete: true = delete the listing on ImmobilienScout24 entirely
(instead of only deactivating it).

This makes listings public (or removes them), so confirm with the user
before calling it. Use list_portals for portal IDs. Check the property is
complete (price, images, energy certificate) before publishing.`,
    {
      property_ids: z.array(z.number()).min(1)
        .describe("Property IDs to publish or unpublish"),
      portal_ids: z.array(z.number()).min(1)
        .describe("Portal IDs (from list_portals)"),
      active: z.boolean().optional()
        .describe("true = publish (default), false = remove from portals"),
      is24_delete: z.boolean().optional()
        .describe("true = delete the listing on ImmobilienScout24 entirely"),
    },
    async (args) => {
      try {
        await client.post("/portals/publish", { body: args });
        const action = args.active === false ? "Removal from" : "Publishing to";
        return textResult(
          `${action} ${args.portal_ids.length} portal(s) requested for ` +
          `${args.property_ids.length} propert${args.property_ids.length === 1 ? "y" : "ies"} ` +
          `(${args.property_ids.join(", ")}). Portal transfers run asynchronously in Propstack.`,
        );
      } catch (err) {
        return errorResult("Portal export", err);
      }
    },
  );
}
