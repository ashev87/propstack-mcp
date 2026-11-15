import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type { PropstackProject, PropstackPaginatedResponse } from "../types/propstack.js";
import { textResult, errorResult, fmt, stripUndefined } from "./helpers.js";

// Writable project fields, per the V1 "Project Schema".
const projectFields = {
  name: z.string().optional()
    .describe("Internal project name"),
  title: z.string().optional()
    .describe("Headline for the exposé"),
  status: z.enum(["ACQUISITION", "PROGRESS", "SALES", "SOLD"]).optional()
    .describe("Project phase: ACQUISITION (Akquise), PROGRESS (in Bau/Vorbereitung), SALES (Vertrieb), SOLD (verkauft)"),
  broker_id: z.number().optional()
    .describe("Responsible broker ID (see list_users)"),
  for_rent: z.boolean().optional()
    .describe("true = project of rental units"),
  street: z.string().optional(),
  house_number: z.string().optional(),
  zip_code: z.string().optional(),
  city: z.string().optional(),
  lat: z.number().optional()
    .describe("Latitude"),
  lng: z.number().optional()
    .describe("Longitude"),
  location_id: z.number().optional()
    .describe("Geolage ID (see list_locations)"),
  construction_year: z.number().int().optional(),
  courtage: z.string().optional()
    .describe("Buyer commission, e.g. '3,57 % inkl. MwSt.'"),
  courtage_note: z.string().optional(),
  description_note: z.string().optional()
    .describe("Project description (Objektbeschreibung)"),
  location_note: z.string().optional()
    .describe("Location description (Lage)"),
  furnishing_note: z.string().optional()
    .describe("Furnishing description (Ausstattung)"),
  note: z.string().optional()
    .describe("Internal note"),
  warning_notice: z.string().optional()
    .describe("Shown as a red warning bar on the project"),
};

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
        const raw = await client.get<PropstackPaginatedResponse<PropstackProject> | PropstackProject[]>(
          "/projects",
          { params: args as Record<string, string | number | boolean | undefined> },
        );
        const projects = Array.isArray(raw) ? raw : raw.data ?? [];
        const totalCount = Array.isArray(raw) ? undefined : raw.meta?.total_count;

        if (projects.length === 0) {
          return textResult("No projects found.");
        }

        const header = totalCount !== undefined
          ? `Found ${totalCount} projects (showing ${projects.length}):\n\n`
          : `Found ${projects.length} projects:\n\n`;

        const table = [
          "| ID | Title | Status | City | Units |",
          "|---|---|---|---|---|",
          ...projects.map(formatProjectRow),
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

  // ── create_project ──────────────────────────────────────────────

  server.tool(
    "create_project",
    `Create a development project (e.g. a new-build complex).

A project groups several property units. After creating it, create the
units with create_property and set their project_id.`,
    {
      ...projectFields,
      name: z.string()
        .describe("Internal project name"),
    },
    async (args) => {
      try {
        const res = await client.post<{ ok?: boolean; id?: number }>("/projects", {
          body: { project: stripUndefined(args) },
        });
        return textResult(`Project "${args.name}" created (ID: ${fmt(res.id)}).`);
      } catch (err) {
        return errorResult("Project", err);
      }
    },
  );

  // ── update_project ──────────────────────────────────────────────

  server.tool(
    "update_project",
    `Update a project. Only provide the fields you want to change.`,
    {
      id: z.number()
        .describe("Project ID"),
      ...projectFields,
    },
    async (args) => {
      try {
        const { id, ...fields } = args;
        const project = stripUndefined(fields);
        if (Object.keys(project).length === 0) {
          return { ...textResult("Nothing to update: provide at least one field."), isError: true as const };
        }
        await client.put(`/projects/${id}`, { body: { project } });
        return textResult(`Project ${id} updated (${Object.keys(project).join(", ")}).`);
      } catch (err) {
        return errorResult("Project", err);
      }
    },
  );
}
