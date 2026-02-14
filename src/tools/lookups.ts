import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type {
  PropstackDealPipeline,
  PropstackTag,
  PropstackSuperGroup,
  PropstackCustomFieldGroup,
  PropstackBroker,
  PropstackTeam,
  PropstackLocation,
} from "../types/propstack.js";
import { textResult, errorResult, fmt } from "./helpers.js";

// ── Response formatting ──────────────────────────────────────────────

function formatPipeline(p: PropstackDealPipeline): string {
  const lines: string[] = [
    `**${fmt(p.name, "Untitled")}** (ID: ${p.id})`,
  ];

  if (p.broker_ids?.length) {
    lines.push(`Brokers: ${p.broker_ids.join(", ")}`);
  }

  if (p.deal_stages?.length) {
    lines.push("Stages:");
    for (const s of p.deal_stages) {
      const chance = s.chance !== null && s.chance !== undefined ? ` (${s.chance}%)` : "";
      lines.push(`  ${s.position ?? "?"}) **${fmt(s.name)}** (ID: ${s.id})${chance}`);
    }
  }

  return lines.join("\n");
}

function formatBroker(b: PropstackBroker): string {
  const lines: (string | null)[] = [
    `**${fmt(b.name)}** (ID: ${b.id})`,
    `Email: ${fmt(b.email)}`,
    b.phone ? `Phone: ${b.phone}` : null,
    b.position ? `Position: ${b.position}` : null,
    b.team_id ? `Team ID: ${b.team_id}` : null,
    b.department_ids?.length ? `Departments: ${b.department_ids.join(", ")}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

// ── Tool registration ────────────────────────────────────────────────

export function registerLookupTools(server: McpServer, client: PropstackClient): void {
  // ── list_pipelines ──────────────────────────────────────────────

  server.tool(
    "list_pipelines",
    `List all deal pipelines and their stages in Propstack.

Returns each pipeline with its ordered stages, including stage IDs,
names, positions, colors, and chance percentages.

You NEED stage IDs from this tool to create or move deals. Call this
before using create_deal or update_deal if you don't know the stage IDs.

Typical pipelines: Sales (Verkauf), Acquisition (Akquise), Rental (Vermietung).
Typical stages: Anfrage → Besichtigung → Reserviert → Notartermin → Verkauft.`,
    {},
    async () => {
      try {
        const pipelines = await client.get<PropstackDealPipeline[]>("/deal_pipelines");

        if (!pipelines || pipelines.length === 0) {
          return textResult("No deal pipelines configured.");
        }

        const formatted = pipelines.map(formatPipeline).join("\n\n---\n\n");
        return textResult(`Deal pipelines:\n\n${formatted}`);
      } catch (err) {
        return errorResult("Pipeline", err);
      }
    },
  );

  // ── get_pipeline ────────────────────────────────────────────────

  server.tool(
    "get_pipeline",
    `Get a single deal pipeline by ID with its stages.

Returns the pipeline with all stages in order. Use this when you
already know which pipeline you need and want its stage details.`,
    {
      id: z.number()
        .describe("Pipeline ID"),
    },
    async (args) => {
      try {
        const pipeline = await client.get<PropstackDealPipeline>(
          `/deal_pipelines/${args.id}`,
        );

        return textResult(formatPipeline(pipeline));
      } catch (err) {
        return errorResult("Pipeline", err);
      }
    },
  );

  // ── list_tags ───────────────────────────────────────────────────

  server.tool(
    "list_tags",
    `List all tags/labels (Merkmale) in Propstack.

Tags are hierarchical — they can belong to a parent tag (Obermerkmal).
Filter by entity type to see only tags relevant to contacts, properties,
or activities.

You need tag IDs to:
- Filter contacts/properties by tag (group[] param)
- Assign tags to contacts (group_ids, add_group_ids)
- Assign tags to properties (property_groups)

Returns the tag tree with parent groups (Obermerkmale) and their children.`,
    {
      entity: z.enum(["for_clients", "for_properties", "for_activities"]).optional()
        .describe("Filter by entity type (default: for_clients)"),
    },
    async (args) => {
      try {
        const params: Record<string, string | undefined> = {};
        if (args.entity) params["entity"] = args.entity;

        const groups = await client.get<PropstackSuperGroup[]>(
          "/groups",
          { params },
        );

        if (!groups || groups.length === 0) {
          return textResult("No tags found.");
        }

        const lines: string[] = [];
        for (const sg of groups) {
          lines.push(`**${fmt(sg.name, "Ungrouped")}** (Super-Group ID: ${sg.id})`);
          if (sg.groups?.length) {
            for (const g of sg.groups) {
              lines.push(`  • ${fmt(g.name)} (ID: ${g.id})`);
            }
          }
        }

        return textResult(`Tags (Merkmale):\n\n${lines.join("\n")}`);
      } catch (err) {
        return errorResult("Tag", err);
      }
    },
  );

  // ── create_tag ──────────────────────────────────────────────────

  server.tool(
    "create_tag",
    `Create a new tag/label (Merkmal) in Propstack.

Tags are used to categorize contacts, properties, and activities.
Optionally assign to a parent super-group (Obermerkmal) for hierarchy.

Examples: "Penthouse-Käufer", "VIP", "Kapitalanleger", "Erstbezug".`,
    {
      name: z.string()
        .describe("Tag name"),
      entity: z.enum(["for_clients", "for_properties", "for_activities"])
        .describe("Which entity type this tag applies to"),
      super_group_id: z.number().optional()
        .describe("Parent super-group ID (Obermerkmal) for hierarchy"),
    },
    async (args) => {
      try {
        const tag = await client.post<PropstackTag>(
          "/groups",
          { body: args },
        );

        return textResult(
          `Tag created: **${fmt(tag.name)}** (ID: ${tag.id})` +
          (tag.super_group_id ? ` — parent group: ${tag.super_group_id}` : ""),
        );
      } catch (err) {
        return errorResult("Tag", err);
      }
    },
  );

  // ── list_custom_fields ──────────────────────────────────────────

  server.tool(
    "list_custom_fields",
    `List custom field definitions for an entity type in Propstack.

IMPORTANT: Call this tool to discover what custom fields exist before
reading or writing custom field values on contacts, properties, etc.

Returns field groups, each containing field definitions with:
- name: The API key to use (e.g. "cf_budget_range")
- pretty_name: Human-readable label (e.g. "Budget Range")
- type: Field type (String, Dropdown, Number, Date, etc.)
- options: Available values for Dropdown fields

To READ custom fields: use expand=true on search or get tools.
To WRITE custom fields: use partial_custom_fields: {"cf_field_name": "value"}.
To FILTER by custom fields: add cf_fieldname=value as a search param.`,
    {
      entity: z.enum(["for_clients", "for_properties", "for_projects", "for_brokers", "for_tasks", "for_deals"])
        .describe("Entity type to get custom fields for"),
    },
    async (args) => {
      try {
        const groups = await client.get<PropstackCustomFieldGroup[]>(
          "/custom_field_groups",
          { params: { entity: args.entity } },
        );

        if (!groups || groups.length === 0) {
          return textResult(`No custom fields configured for ${args.entity}.`);
        }

        const lines: string[] = [];
        for (const g of groups) {
          lines.push(`**${fmt(g.name, "Default")}** (Group ID: ${g.id})`);
          if (g.fields?.length) {
            for (const f of g.fields) {
              let desc = `  • \`${f.name}\` — ${fmt(f.pretty_name)} (${fmt(f.type)})`;
              if (f.options?.length) {
                desc += `\n    Options: ${f.options.join(", ")}`;
              }
              lines.push(desc);
            }
          }
        }

        return textResult(`Custom fields for ${args.entity}:\n\n${lines.join("\n")}`);
      } catch (err) {
        return errorResult("Custom field", err);
      }
    },
  );

  // ── list_users ──────────────────────────────────────────────────

  server.tool(
    "list_users",
    `List all brokers/agents (Nutzer) in the Propstack account.

Returns team members with their IDs, names, email, phone, position,
team, and department assignments.

You need broker IDs for:
- Assigning contacts or properties to a broker
- Filtering by broker in search tools
- Setting the sender for emails (send_email broker_id)
- Assigning tasks and events`,
    {},
    async () => {
      try {
        const brokers = await client.get<PropstackBroker[]>("/brokers");

        if (!brokers || brokers.length === 0) {
          return textResult("No brokers/users found.");
        }

        const formatted = brokers.map(formatBroker).join("\n\n---\n\n");
        return textResult(`Brokers/Users:\n\n${formatted}`);
      } catch (err) {
        return errorResult("Broker", err);
      }
    },
  );

  // ── list_teams ──────────────────────────────────────────────────

  server.tool(
    "list_teams",
    `List all teams/departments in Propstack.

Returns teams with their broker member assignments. Use for team-level
filtering and to understand the organizational structure.`,
    {},
    async () => {
      try {
        const teams = await client.get<PropstackTeam[]>("/teams");

        if (!teams || teams.length === 0) {
          return textResult("No teams configured.");
        }

        const lines = teams.map((t) => {
          const members = t.broker_ids?.length ? `Members: ${t.broker_ids.join(", ")}` : "No members";
          return `**${fmt(t.name)}** (ID: ${t.id}) — ${members}`;
        });

        return textResult(`Teams:\n\n${lines.join("\n")}`);
      } catch (err) {
        return errorResult("Team", err);
      }
    },
  );

  // ── list_locations ──────────────────────────────────────────────

  server.tool(
    "list_locations",
    `List geographic areas/districts (Geolagen) in Propstack.

Returns location IDs and names used for property and search profile
location matching. Use location IDs when creating search profiles
or filtering properties by area.`,
    {},
    async () => {
      try {
        const locations = await client.get<PropstackLocation[]>("/locations");

        if (!locations || locations.length === 0) {
          return textResult("No locations configured.");
        }

        const lines = locations.map(
          (l) => `- **${fmt(l.name)}** (ID: ${l.id})`,
        );

        return textResult(`Locations:\n\n${lines.join("\n")}`);
      } catch (err) {
        return errorResult("Location", err);
      }
    },
  );
}
