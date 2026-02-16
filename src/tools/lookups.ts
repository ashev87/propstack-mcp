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
  PropstackActivityType,
  PropstackContactStatus,
  PropstackReservationReason,
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

  // ── list_tags / list_groups ──────────────────────────────────────

  server.tool(
    "list_tags",
    `List all tags/labels (Merkmale/Gruppen) in Propstack.

Use these IDs to filter contacts (search_contacts group param) or assign
tags (create_contact/update_contact group_ids). Filter by entity to get
tags for contacts, properties, or activities.

Entity: for_clients (default), for_properties, for_activities.

Returns flat list: **Name** (ID: 123). Use super_groups param to optionally
try hierarchical view via /super_groups.`,
    {
      entity: z.enum(["for_clients", "for_properties", "for_activities"]).optional()
        .describe("Filter by entity type (default: for_clients)"),
      super_groups: z.boolean().optional()
        .describe("If true, fetch hierarchical structure from /super_groups (Obermerkmale with children)"),
    },
    async (args) => {
      try {
        const params: Record<string, string | undefined> = {};
        if (args.entity) params["entity"] = args.entity;

        if (args.super_groups) {
          const res = await client.get<{ data?: PropstackSuperGroup[] } | PropstackSuperGroup[]>(
            "/super_groups",
            { params: { ...params, include: "groups" } },
          );
          const sgs = Array.isArray(res) ? res : res?.data ?? [];
          if (!sgs.length) return textResult("No super groups found.");

          const lines: string[] = [];
          for (const sg of sgs) {
            lines.push(`**${fmt(sg.name, "Ungrouped")}** (ID: ${sg.id})`);
            if (sg.groups?.length) {
              for (const g of sg.groups) {
                lines.push(`  • ${fmt(g.name)} (ID: ${g.id})`);
              }
            }
          }
          return textResult(`Tags (hierarchical):\n\n${lines.join("\n")}`);
        }

        const raw = await client.get<PropstackTag[] | PropstackSuperGroup[]>(
          "/groups",
          { params },
        );
        const items = Array.isArray(raw) ? raw : [];

        if (!items.length) {
          return textResult("No tags found.");
        }

        // API returns flat [{id, name, super_group_id, public_name}] or hierarchical [{id, name, groups: []}]
        const flatItems: { id: number; name: string | null; super_group_id?: number | null }[] = [];
        for (const item of items) {
          const sg = item as PropstackSuperGroup & PropstackTag;
          if (sg.groups?.length) {
            for (const g of sg.groups) flatItems.push({ id: g.id, name: g.name, super_group_id: g.super_group_id });
          } else {
            flatItems.push({
              id: (item as PropstackTag).id,
              name: (item as PropstackTag).name,
              super_group_id: (item as PropstackTag).super_group_id,
            });
          }
        }

        const lines = flatItems.map((g) => `- **${fmt(g.name)}** (ID: ${g.id})`);

        return textResult(`Tags/Groups (Merkmale) — use these IDs for search_contacts group filter:\n\n${lines.join("\n")}`);
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

  // ── list_activity_types ─────────────────────────────────────────

  server.tool(
    "list_activity_types",
    `List all activity/task types in Propstack.

These are templates for creating notes, todos (reminders), events, and messages.
Each has an id, name, and category. Use these IDs when creating tasks:
- category "for_notes" → note_type_id in create_task
- category "for_reminders" → todo_type_id (when is_reminder: true)
- category "for_events" → event_type_id (when is_event: true)
- category "message" → snippet_id for email templates

Categories map to search_activities filter: for_notes→note, for_reminders→reminder,
for_events→event, message→message.`,
    {
      category: z.enum(["message", "for_notes", "for_reminders", "for_events"]).optional()
        .describe("Filter by category (message, for_notes, for_reminders, for_events)"),
    },
    async (args) => {
      try {
        const res = await client.get<PropstackActivityType[] | { data: PropstackActivityType[] }>(
          "/activity_types",
          args.category ? { params: { category: args.category } } : undefined,
        );
        let types = Array.isArray(res) ? res : (res as { data: PropstackActivityType[] })?.data ?? [];
        if (args.category) {
          types = types.filter((t) => fmt(t.category) === args.category);
        }
        if (!types.length) {
          return textResult(args.category
            ? `No activity types in category "${args.category}".`
            : "No activity types configured.");
        }
        const lines = types.map((t) => {
          const cat = fmt(t.category, "");
          return `- **${fmt(t.name)}** (ID: ${t.id}) — ${cat}`;
        });
        return textResult(`Activity types${args.category ? ` (${args.category})` : ""}:\n\n${lines.join("\n")}`);
      } catch (err) {
        return errorResult("Activity type", err);
      }
    },
  );

  // ── list_contact_statuses ──────────────────────────────────────

  server.tool(
    "list_contact_statuses",
    `List contact statuses (Kontaktstatus) in Propstack.

Use these IDs for search_contacts (status param) and create_contact/update_contact
(client_status_id). E.g. "Lead", "Kunde", "Archiviert".`,
    {},
    async () => {
      try {
        const raw = await client.get<PropstackContactStatus[] | { data: PropstackContactStatus[] }>(
          "/contact_statuses",
        );
        const items = Array.isArray(raw) ? raw : raw?.data ?? [];
        if (!items.length) return textResult("No contact statuses found.");
        const lines = items.map((s) => `- **${fmt(s.name)}** (ID: ${s.id})`);
        return textResult(`Contact statuses:\n\n${lines.join("\n")}`);
      } catch (err) {
        return errorResult("Contact status", err);
      }
    },
  );

  // ── list_reservation_reasons ────────────────────────────────────

  server.tool(
    "list_reservation_reasons",
    `List deal cancellation reasons (Reservierungsgründe/Absagegründe).

Use when creating deal cancellations (create_task with reservation_reason_id)
or filtering lost deals (search_deals reservation_reason_ids).`,
    {},
    async () => {
      try {
        const raw = await client.get<PropstackReservationReason[] | { data: PropstackReservationReason[] }>(
          "/reservation_reasons",
        );
        const items = Array.isArray(raw) ? raw : raw?.data ?? [];
        if (!items.length) return textResult("No reservation reasons found.");
        const lines = items.map((r) => `- **${fmt(r.name)}** (ID: ${r.id})`);
        return textResult(`Reservation/cancellation reasons:\n\n${lines.join("\n")}`);
      } catch (err) {
        return errorResult("Reservation reason", err);
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
