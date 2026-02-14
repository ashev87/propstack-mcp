import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type { PropstackProject, PropstackPaginatedResponse } from "../types/propstack.js";
import { textResult, errorResult, fmt } from "./helpers.js";

// ── Response formatting ──────────────────────────────────────────────

function formatProject(p: PropstackProject): string {
  const title = fmt(p.title ?? p.name, "Untitled");
  const addr = [p.street, p.house_number].filter(Boolean).join(" ");
  const cityLine = [p.zip_code, p.city].filter(Boolean).join(" ");
  const fullAddress = [addr, cityLine, p.country].filter(Boolean).join(", ");

  const lines: (string | null)[] = [
    `**${title}** (ID: ${p.id})`,
    `Status: ${fmt(p.status)}`,
    `Address: ${fullAddress || "none"}`,
    `Broker: ${fmt(p.broker_id, "unassigned")}`,
  ];

  // Units summary
  if (p.units && p.units.length > 0) {
    lines.push(`Units: ${p.units.length}`);
    for (const u of p.units) {
      const uAddr = [u.street, u.house_number].filter(Boolean).join(" ");
      lines.push(`  • ${fmt(u.title, "Untitled")} (ID: ${u.id}) — ${fmt(u.property_status?.name)} ${uAddr ? `— ${uAddr}` : ""}`);
    }
  }

  // Media counts
  if (p.images?.length) lines.push(`Images: ${p.images.length}`);
  if (p.floorplans?.length) lines.push(`Floorplans: ${p.floorplans.length}`);
  if (p.documents?.length) lines.push(`Documents: ${p.documents.length}`);
  if (p.links?.length) lines.push(`Links: ${p.links.length}`);

  lines.push(`Created: ${fmt(p.created_at)}`);

  return lines.filter(Boolean).join("\n");
}

function formatProjectRow(p: PropstackProject): string {
  const title = fmt(p.title ?? p.name, "Untitled");
  const cityLine = [p.zip_code, p.city].filter(Boolean).join(" ");
  const unitCount = p.units?.length ?? "—";
  return `| ${p.id} | ${title} | ${fmt(p.status)} | ${cityLine || "—"} | ${unitCount} |`;
}

// ── Tool registration ────────────────────────────────────────────────

export function registerProjectTools(server: McpServer, client: PropstackClient): void {
  // ── list_projects ───────────────────────────────────────────────

  server.tool(
    "list_projects",
    `List development projects in Propstack.

A project is a "super-object" that groups multiple property units
(e.g. a new-build apartment complex with 20 units).

Use this tool to:
- See all active development projects
- Get an overview of unit counts and statuses
- Find a project by name before drilling into its units

Use expand=true to include custom fields in the response.`,
    {
      expand: z.boolean().optional()
        .describe("Include custom fields in response"),
      page: z.number().optional()
        .describe("Page number (default: 1)"),
      per_page: z.number().optional()
        .describe("Results per page (default: 25)"),
    },
    async (args) => {
      try {
        const res = await client.get<PropstackPaginatedResponse<PropstackProject>>(
          "/projects",
          { params: args as Record<string, string | number | boolean | undefined> },
        );

        if (!res.data || res.data.length === 0) {
          return textResult("No projects found.");
        }

        const header = res.meta?.total_count !== undefined
          ? `Found ${res.meta.total_count} projects (showing ${res.data.length}):\n\n`
          : `Found ${res.data.length} projects:\n\n`;

        const table = [
          "| ID | Title | Status | City | Units |",
          "|---|---|---|---|---|",
          ...res.data.map(formatProjectRow),
        ].join("\n");

        return textResult(header + table);
      } catch (err) {
        return errorResult("Project", err);
      }
    },
  );

  // ── get_project ─────────────────────────────────────────────────

  server.tool(
    "get_project",
    `Get full details of a single project by ID.

Returns the complete project with all units, images, floorplans,
documents, and links.

Use this tool to:
- See how a project is performing (unit statuses)
- Check how many units are still available vs. sold/reserved
- View project media and documents
- Get unit-level details (prices, sizes, statuses)`,
    {
      id: z.number()
        .describe("Project ID"),
    },
    async (args) => {
      try {
        const project = await client.get<PropstackProject>(
          `/projects/${args.id}`,
        );

        return textResult(formatProject(project));
      } catch (err) {
        return errorResult("Project", err);
      }
    },
  );
}
