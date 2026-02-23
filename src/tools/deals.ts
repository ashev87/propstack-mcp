import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type { PropstackDeal, PropstackDealPipeline, PropstackPaginatedResponse } from "../types/propstack.js";
import { textResult, errorResult, fmt, fmtPrice, stripUndefined } from "./helpers.js";

// ── Response formatting ──────────────────────────────────────────────

const FEELING_LABELS = ["none", "cold", "warm", "hot"] as const;

/** Fetch pipelines with safe unwrapping — API returns { data: [...] }. */
export async function fetchPipelines(client: PropstackClient): Promise<PropstackDealPipeline[]> {
  const raw = await client.get<{ data: PropstackDealPipeline[] } | PropstackDealPipeline[]>("/deal_pipelines");
  return Array.isArray(raw) ? raw : raw?.data ?? [];
}

/** Build stage/pipeline name lookup from pipeline definitions and enrich deals in place. */
export function enrichDealsWithStageNames(deals: PropstackDeal[], pipelines: PropstackDealPipeline[]): void {
  const stageMap = new Map<number, { name: string; pipeline: string }>();
  for (const p of pipelines) {
    const pName = p.name ?? `Pipeline #${p.id}`;
    if (p.deal_stages) {
      for (const s of p.deal_stages) {
        stageMap.set(s.id, { name: s.name ?? `Stage #${s.id}`, pipeline: pName });
      }
    }
  }
  for (const d of deals) {
    if (!d.deal_stage && d.deal_stage_id) {
      const info = stageMap.get(d.deal_stage_id);
      if (info) {
        d.deal_stage = { id: d.deal_stage_id, name: info.name, position: null, color: null, chance: null };
      }
    }
    if (!d.deal_pipeline && d.deal_pipeline_id) {
      const p = pipelines.find((p) => p.id === d.deal_pipeline_id);
      if (p) {
        d.deal_pipeline = p;
      }
    }
  }
}

function formatDeal(d: PropstackDeal): string {
  const clientName = d.client
    ? (fmt(d.client.name) !== "none" ? fmt(d.client.name) : [fmt(d.client.first_name, ""), fmt(d.client.last_name, "")].filter(Boolean).join(" ") || "Unnamed")
    : `Contact #${d.client_id ?? "?"}`;

  const propertyTitle = d.property
    ? fmt(d.property.title, "Untitled")
    : `Property #${d.property_id ?? "?"}`;

  const stageName = d.deal_stage
    ? (d.deal_stage.name ?? `Stage #${d.deal_stage_id}`)
    : d.deal_stage_id ? `Stage #${d.deal_stage_id}` : null;

  const pipelineName = d.deal_pipeline
    ? (d.deal_pipeline.name ?? `Pipeline #${d.deal_pipeline_id}`)
    : d.deal_pipeline_id ? `Pipeline #${d.deal_pipeline_id}` : null;

  const lines: (string | null)[] = [
    `**Deal #${d.id}**: ${clientName} → ${propertyTitle}`,
    stageName || pipelineName
      ? [stageName, pipelineName].filter(Boolean).join(" | ")
      : null,
    d.category ? `Category: ${d.category}` : null,
    d.sold_price ? `Price: ${fmtPrice(d.sold_price)}` : null,
    d.feeling !== null && d.feeling !== undefined
      ? `Feeling: ${FEELING_LABELS[d.feeling] ?? d.feeling}`
      : null,
    `Broker: ${fmt(d.broker_id, "unassigned")}`,
    d.note ? `Note: ${d.note}` : null,
    d.date ? `Date: ${d.date}` : null,
    d.reservation_reason_id ? `Cancellation reason ID: ${d.reservation_reason_id}` : null,
    `Created: ${fmt(d.created_at)}`,
  ];

  // Show expanded contact details
  if (d.client) {
    lines.push(`Contact: ${clientName} (ID: ${d.client.id}, Email: ${fmt(d.client.email)}, Phone: ${fmt(d.client.phone ?? d.client.home_cell)})`);
  }

  // Show expanded property details
  if (d.property) {
    const addr = [fmt(d.property.street, ""), fmt(d.property.house_number, "")].filter(Boolean).join(" ");
    const city = [fmt(d.property.zip_code, ""), fmt(d.property.city, "")].filter(Boolean).join(" ");
    const fullAddr = [addr, city].filter(Boolean).join(", ");
    lines.push(`Property: ${propertyTitle} (ID: ${d.property.id}, ${fullAddr || "no address"}, ${fmtPrice(d.property.price)})`);
  }

  return lines.filter(Boolean).join("\n");
}

function formatDealRow(d: PropstackDeal): string {
  const clientName = d.client
    ? (fmt(d.client.name) !== "none" ? fmt(d.client.name) : [fmt(d.client.first_name, ""), fmt(d.client.last_name, "")].filter(Boolean).join(" ") || "Unnamed")
    : String(d.client_id ?? "?");

  const propertyTitle = d.property
    ? fmt(d.property.title, "—")
    : String(d.property_id ?? "?");

  const stageName = d.deal_stage
    ? (d.deal_stage.name ?? `#${d.deal_stage_id}`)
    : d.deal_stage_id ? `#${d.deal_stage_id}` : "—";

  const category = d.category ?? "—";
  const feeling = d.feeling !== null && d.feeling !== undefined
    ? (FEELING_LABELS[d.feeling] ?? String(d.feeling))
    : "—";

  return `| ${d.id} | ${clientName} | ${propertyTitle} | ${stageName} | ${category} | ${feeling} | ${fmt(d.created_at, "—")} |`;
}

// ── Tool registration ────────────────────────────────────────────────

export function registerDealTools(server: McpServer, client: PropstackClient): void {
  // ── search_deals ────────────────────────────────────────────────

  server.tool(
    "search_deals",
    `Search and filter deals (contact↔property relationships) in Propstack.

Use this tool to:
- Show all deals in a specific pipeline stage
- Find deals for a contact or property
- Track deal pipeline progress for a project
- Find lost deals and cancellation reasons
- Filter by broker, team, feeling (cold/warm/hot)

A "deal" represents an interested contact linked to a property at a
specific stage in a sales/rental pipeline (e.g. Anfrage → Besichtigung
→ Reserviert → Notartermin → Verkauft).

Use include="client,property" to get expanded contact and property
details in one request.

Common queries:
- All active deals: category="qualified"
- Lost deals this month: category="lost" + created_at_from
- Deals for a property: property_id=123
- Pipeline view: deal_pipeline_id + sort_by=deal_stage_id`,
    {
      client_id: z.number().optional()
        .describe("Filter by contact ID"),
      property_id: z.number().optional()
        .describe("Filter by property ID"),
      project_id: z.number().optional()
        .describe("Filter by project ID"),
      broker_id: z.number().optional()
        .describe("Filter by assigned broker ID"),
      deal_stage_ids: z.array(z.number()).optional()
        .describe("Filter by deal stage IDs (pipeline steps)"),
      deal_pipeline_id: z.number().optional()
        .describe("Filter by deal pipeline ID"),
      category: z.enum(["qualified", "unqualified", "lost"]).optional()
        .describe("Deal category: qualified (active), unqualified (not yet), lost (cancelled/rejected)"),
      reservation_reason_ids: z.array(z.number()).optional()
        .describe("Filter by cancellation/reservation reason IDs"),
      client_source_id: z.number().optional()
        .describe("Filter by lead source ID"),
      team_id: z.number().optional()
        .describe("Filter by team ID"),
      property_broker_ids: z.array(z.number()).optional()
        .describe("Filter by property's assigned broker IDs"),
      client_broker_ids: z.array(z.number()).optional()
        .describe("Filter by contact's assigned broker IDs"),
      feeling_from: z.number().optional()
        .describe("Minimum feeling score (0=none, 1=cold, 2=warm, 3=hot)"),
      feeling_to: z.number().optional()
        .describe("Maximum feeling score"),
      created_at_from: z.string().optional()
        .describe("Filter deals created after this date (ISO 8601)"),
      created_at_to: z.string().optional()
        .describe("Filter deals created before this date (ISO 8601)"),
      start_date_from: z.string().optional()
        .describe("Filter by deal start date from (ISO 8601)"),
      start_date_to: z.string().optional()
        .describe("Filter by deal start date to (ISO 8601)"),
      show_archived_clients: z.boolean().optional()
        .describe("Include deals with archived contacts"),
      hide_archived_properties: z.boolean().optional()
        .describe("Exclude deals with archived properties"),
      include: z.string().optional()
        .describe("Comma-separated related data to expand: 'client', 'property', or 'client,property'"),
      sort_by: z.string().optional()
        .describe("Field to sort results by"),
      order: z.enum(["asc", "desc"]).optional()
        .describe("Sort order (default: desc)"),
      page: z.number().optional()
        .describe("Page number (default: 1)"),
      per_page: z.number().optional()
        .describe("Results per page (default: 25)"),
    },
    async (args) => {
      try {
        const [res, pipelines] = await Promise.all([
          client.get<PropstackPaginatedResponse<PropstackDeal>>(
            "/client_properties",
            { params: args as Record<string, string | number | boolean | string[] | number[] | undefined> },
          ),
          fetchPipelines(client).catch(() => [] as PropstackDealPipeline[]),
        ]);

        if (!res.data || res.data.length === 0) {
          return textResult("No deals found matching your criteria.");
        }

        // Enrich deals with stage/pipeline names from lookup
        enrichDealsWithStageNames(res.data, pipelines);

        const header = res.meta?.total_count !== undefined
          ? `Found ${res.meta.total_count} deals (showing ${res.data.length}):\n\n`
          : `Found ${res.data.length} deals:\n\n`;

        const table = [
          "| ID | Contact | Property | Stage | Category | Feeling | Created |",
          "|---|---|---|---|---|---|---|",
          ...res.data.map(formatDealRow),
        ].join("\n");

        return textResult(header + table);
      } catch (err) {
        return errorResult("Deal", err);
      }
    },
  );

  // ── create_deal ─────────────────────────────────────────────────

  server.tool(
    "create_deal",
    `Create a deal linking an interested contact to a property in Propstack.

A deal represents a contact's interest in a property and tracks it
through pipeline stages (e.g. Anfrage → Besichtigung → Reserviert →
Notartermin → Verkauft).

Use this tool after:
- A viewing to formalize interest
- A contact inquiry about a property
- Moving a lead into the sales pipeline

Requires client_id, property_id, and deal_stage_id. Use list_pipelines or
get_pipeline to find valid pipeline and stage IDs.`,
    {
      client_id: z.number()
        .describe("Contact ID (required)"),
      property_id: z.number()
        .describe("Property ID (required)"),
      deal_stage_id: z.number()
        .describe("Pipeline stage ID (required — use list_pipelines or get_pipeline to look up)"),
      broker_id: z.number().optional()
        .describe("Assigned broker ID"),
      deal_pipeline_id: z.number().optional()
        .describe("Pipeline ID (if multiple pipelines exist)"),
      sold_price: z.number().optional()
        .describe("Expected or agreed price"),
      note: z.string().optional()
        .describe("Free-text note about this deal"),
      date: z.string().optional()
        .describe("Deal date (ISO 8601)"),
      feeling: z.number().optional()
        .describe("Feeling score: 0=none, 1=cold, 2=warm, 3=hot"),
    },
    async (args) => {
      try {
        const [deal, pipelines] = await Promise.all([
          client.post<PropstackDeal>(
            "/client_properties",
            { body: { client_property: stripUndefined(args) } },
          ),
          fetchPipelines(client).catch(() => [] as PropstackDealPipeline[]),
        ]);

        enrichDealsWithStageNames([deal], pipelines);
        return textResult(`Deal created successfully.\n\n${formatDeal(deal)}`);
      } catch (err) {
        return errorResult("Deal", err);
      }
    },
  );

  // ── update_deal ─────────────────────────────────────────────────

  server.tool(
    "update_deal",
    `Update an existing deal in Propstack.

Use this tool to:
- Move a deal to the next pipeline stage (change deal_stage_id)
- Update expected/agreed price
- Add or update notes
- Change broker assignment
- Update feeling score after contact
- Record cancellation reason

Only provide the fields you want to change.`,
    {
      id: z.number()
        .describe("Deal ID to update"),
      client_id: z.number().optional()
        .describe("Contact ID"),
      property_id: z.number().optional()
        .describe("Property ID"),
      deal_stage_id: z.number().optional()
        .describe("Pipeline stage ID — change this to move through pipeline"),
      broker_id: z.number().optional()
        .describe("Assigned broker ID"),
      deal_pipeline_id: z.number().optional()
        .describe("Pipeline ID"),
      sold_price: z.number().optional()
        .describe("Expected or agreed price"),
      note: z.string().optional()
        .describe("Free-text note about this deal"),
      date: z.string().optional()
        .describe("Deal date (ISO 8601)"),
      feeling: z.number().optional()
        .describe("Feeling score: 0=none, 1=cold, 2=warm, 3=hot"),
      category: z.enum(["qualified", "unqualified", "lost"]).optional()
        .describe("Deal category"),
      reservation_reason_id: z.number().optional()
        .describe("Cancellation/reservation reason ID (for lost deals)"),
    },
    async (args) => {
      try {
        const { id, ...fields } = args;
        const [deal, pipelines] = await Promise.all([
          client.put<PropstackDeal>(
            `/client_properties/${id}`,
            { body: { client_property: stripUndefined(fields) } },
          ),
          fetchPipelines(client).catch(() => [] as PropstackDealPipeline[]),
        ]);

        enrichDealsWithStageNames([deal], pipelines);
        return textResult(`Deal updated successfully.\n\n${formatDeal(deal)}`);
      } catch (err) {
        return errorResult("Deal", err);
      }
    },
  );
}
