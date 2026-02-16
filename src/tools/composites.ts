import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type {
  PropstackContact,
  PropstackProperty,
  PropstackDeal,
  PropstackActivity,
  PropstackSearchProfile,
  PropstackDealPipeline,
  PropstackTask,
  PropstackPaginatedResponse,
} from "../types/propstack.js";
import { textResult, errorResult, fmt, fmtPrice, fmtArea, formatError, stripUndefined, unwrapNumber } from "./helpers.js";

function daysBetween(from: string, to: Date): number {
  return Math.floor((to.getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24));
}

function contactName(c: PropstackContact): string {
  return fmt(c.name) !== "none" ? fmt(c.name) : ([fmt(c.first_name, ""), fmt(c.last_name, "")].filter(Boolean).join(" ") || "Unknown");
}

// ── Tool registration ────────────────────────────────────────────────

export function registerCompositeTools(server: McpServer, client: PropstackClient): void {
  // ── full_contact_360 ────────────────────────────────────────────

  server.tool(
    "full_contact_360",
    `Get a complete 360° view of a contact — everything you need before calling a client.

Combines 4 API calls in parallel:
- Full contact details with children, documents, relationships, owned properties
- Search profiles (what they're looking for)
- Active deals (which properties they're linked to)
- Recent activity (last 10 interactions)

Returns a complete contact dossier in one request. Use this when you
need the full picture: "Tell me everything about Herr Weber."`,
    {
      contact_id: z.number()
        .describe("Contact ID to get 360° view for"),
    },
    async (args) => {
      try {
        const [contactRes, searchProfilesRes, dealsRes, activitiesRes] = await Promise.allSettled([
          client.get<PropstackContact>(
            `/contacts/${args.contact_id}`,
            { params: { include: "children,documents,relationships,owned_properties", expand: "true" } },
          ),
          client.get<PropstackPaginatedResponse<PropstackSearchProfile>>(
            "/saved_queries",
            { params: { client: args.contact_id } },
          ),
          client.get<PropstackPaginatedResponse<PropstackDeal>>(
            "/client_properties",
            { params: { client_id: args.contact_id, include: "client,property" } },
          ),
          client.get<PropstackPaginatedResponse<PropstackActivity>>(
            "/activities",
            { params: { client_id: args.contact_id, per: 10 } },
          ),
        ]);

        // Contact is essential — if it fails, return error
        if (contactRes.status === "rejected") {
          return errorResult("Contact 360", contactRes.reason);
        }

        const contact = contactRes.value;
        const sections: string[] = [];
        const warnings: string[] = [];

        // ── Personal info
        const name = contactName(contact);
        const personalLines: (string | null)[] = [
          `# ${name} (ID: ${contact.id})`,
          "",
          `Email: ${fmt(contact.email)}`,
          `Phone: ${fmt(contact.phone ?? contact.home_cell)}`,
          contact.company ? `Company: ${contact.company}` : null,
          contact.position ? `Position: ${contact.position}` : null,
          `Status: ${fmt(contact.client_status?.name)}`,
          `Broker: ${fmt(contact.broker?.name, "unassigned")}`,
          `Rating: ${"★".repeat(Math.max(0, Math.min(3, contact.rating ?? 0)))}${"☆".repeat(3 - Math.max(0, Math.min(3, contact.rating ?? 0)))}`,
          `GDPR: ${(["Keine Angabe", "Ignoriert", "Zugestimmt", "Widerrufen"] as const)[contact.gdpr_status ?? 0] ?? "unknown"}`,
          `Last contact: ${fmt(contact.last_contact_at_formatted, "never")}`,
          contact.warning_notice ? `Warning: ${contact.warning_notice}` : null,
          contact.description ? `Notes: ${contact.description}` : null,
        ];

        // Address
        const homeAddr = [contact.home_street, contact.home_house_number].filter(Boolean).join(" ");
        const homeCity = [contact.home_zip_code, contact.home_city].filter(Boolean).join(" ");
        const homeFull = [homeAddr, homeCity].filter(Boolean).join(", ");
        if (homeFull) personalLines.push(`Home: ${homeFull}`);

        // Children
        if (contact.children?.length) {
          personalLines.push(`Sub-contacts: ${contact.children.map((c) => `${contactName(c)} (ID: ${c.id})`).join(", ")}`);
        }

        // Owned properties
        if (contact.owned_properties?.length) {
          personalLines.push(`Owned properties: ${contact.owned_properties.map((p) => `${fmt(p.title, "Untitled")} (ID: ${p.id})`).join(", ")}`);
        }

        // Documents
        if (contact.documents?.length) {
          personalLines.push(`Documents: ${contact.documents.length} file(s)`);
        }

        // Custom fields
        if (contact.custom_fields && Object.keys(contact.custom_fields).length > 0) {
          personalLines.push("");
          personalLines.push("**Custom Fields:**");
          for (const [key, val] of Object.entries(contact.custom_fields)) {
            const s = fmt(val, "");
            if (s) personalLines.push(`  ${key}: ${s}`);
          }
        }

        sections.push(personalLines.filter((l) => l !== null).join("\n"));

        // ── Search profiles
        if (searchProfilesRes.status === "fulfilled") {
          const profiles = searchProfilesRes.value.data ?? [];
          if (profiles.length > 0) {
            const spLines: string[] = [`## Search Profiles (${profiles.length})`, ""];
            for (const sp of profiles) {
              const parts: string[] = [`**Profile #${sp.id}** (${sp.active ? "active" : "inactive"})`];
              if (sp.marketing_type) parts.push(`  Type: ${sp.marketing_type}`);
              if (sp.cities?.length) parts.push(`  Cities: ${sp.cities.join(", ")}`);
              if (sp.rs_types?.length) parts.push(`  Property types: ${sp.rs_types.join(", ")}`);
              if (sp.price !== null || sp.price_to !== null) {
                parts.push(`  Price: ${fmtPrice(sp.price)} – ${fmtPrice(sp.price_to)}`);
              }
              if (sp.base_rent !== null || sp.base_rent_to !== null) {
                parts.push(`  Rent: ${fmtPrice(sp.base_rent)} – ${fmtPrice(sp.base_rent_to)}`);
              }
              if (sp.number_of_rooms !== null || sp.number_of_rooms_to !== null) {
                parts.push(`  Rooms: ${fmt(sp.number_of_rooms)} – ${fmt(sp.number_of_rooms_to)}`);
              }
              if (sp.living_space !== null || sp.living_space_to !== null) {
                parts.push(`  Space: ${fmt(sp.living_space)} – ${fmt(sp.living_space_to)} m²`);
              }
              if (sp.note) parts.push(`  Note: ${sp.note}`);
              spLines.push(parts.join("\n"));
            }
            sections.push(spLines.join("\n"));
          } else {
            sections.push("## Search Profiles\nNone — contact has no active search criteria.");
          }
        } else {
          warnings.push("Search profiles");
          sections.push(`## Search Profiles\nFailed to load: ${formatError(searchProfilesRes.reason)}`);
        }

        // ── Deals
        if (dealsRes.status === "fulfilled") {
          const dealList = dealsRes.value.data ?? [];
          if (dealList.length > 0) {
            const dealLines: string[] = [`## Deals (${dealList.length})`, ""];
            for (const d of dealList) {
              const propTitle = d.property ? fmt(d.property.title, "Untitled") : `Property #${d.property_id}`;
              const parts = [
                `**Deal #${d.id}**: ${propTitle}`,
                `  Stage: ${fmt(d.deal_stage_id)} | Category: ${fmt(d.category)}`,
              ];
              if (d.sold_price) parts.push(`  Price: ${fmtPrice(d.sold_price)}`);
              if (d.note) parts.push(`  Note: ${d.note}`);
              parts.push(`  Created: ${fmt(d.created_at)}`);
              dealLines.push(parts.join("\n"));
            }
            sections.push(dealLines.join("\n"));
          } else {
            sections.push("## Deals\nNo deals — contact is not linked to any properties in the pipeline.");
          }
        } else {
          warnings.push("Deals");
          sections.push(`## Deals\nFailed to load: ${formatError(dealsRes.reason)}`);
        }

        // ── Recent activity
        if (activitiesRes.status === "fulfilled") {
          const activityList = activitiesRes.value.data ?? [];
          if (activityList.length > 0) {
            const actLines: string[] = [`## Recent Activity (last ${activityList.length})`, ""];
            for (const a of activityList) {
              actLines.push(`- **${fmt(a.type)}** ${fmt(a.title, "")} — ${fmt(a.created_at)}`);
            }
            sections.push(actLines.join("\n"));
          } else {
            sections.push("## Recent Activity\nNo recorded activity.");
          }
        } else {
          warnings.push("Activities");
          sections.push(`## Recent Activity\nFailed to load: ${formatError(activitiesRes.reason)}`);
        }

        if (warnings.length > 0) {
          sections.push(`\n**Note:** Some sections failed to load (${warnings.join(", ")}). The rest of the data is shown above.`);
        }

        return textResult(sections.join("\n\n---\n\n"));
      } catch (err) {
        return errorResult("Contact 360", err);
      }
    },
  );

  // ── property_performance_report ─────────────────────────────────

  server.tool(
    "property_performance_report",
    `Performance report for a property — days on market, inquiry count,
pipeline breakdown, and activity summary.

Combines 3 API calls in parallel:
- Full property details (with custom fields)
- All deals/inquiries for this property
- Activity feed (last 50 interactions)

Calculates: days on market, total inquiries, deals by stage/category,
and recent activity breakdown by type.

Use when asked: "How is the Friedrichstr property doing?"`,
    {
      property_id: z.number()
        .describe("Property ID to generate report for"),
    },
    async (args) => {
      try {
        const [propertyRes, dealsRes, activitiesRes] = await Promise.allSettled([
          client.get<PropstackProperty>(
            `/units/${args.property_id}`,
            { params: { new: 1, expand: 1 } },
          ),
          client.get<PropstackPaginatedResponse<PropstackDeal>>(
            "/client_properties",
            { params: { property_id: args.property_id, include: "client" } },
          ),
          client.get<PropstackPaginatedResponse<PropstackActivity>>(
            "/activities",
            { params: { property_id: args.property_id, per: 50 } },
          ),
        ]);

        // Property is essential
        if (propertyRes.status === "rejected") {
          return errorResult("Property report", propertyRes.reason);
        }

        const property = propertyRes.value;
        const sections: string[] = [];
        const warnings: string[] = [];
        const now = new Date();

        // ── Property summary
        const title = fmt(property.title, "Untitled");
        const addr = [property.street, property.house_number].filter(Boolean).join(" ");
        const city = [property.zip_code, property.city].filter(Boolean).join(" ");
        const fullAddr = [addr, city].filter(Boolean).join(", ");
        const dom = property.created_at ? daysBetween(property.created_at, now) : null;

        const propLines: (string | null)[] = [
          `# Property Report: ${title} (ID: ${property.id})`,
          "",
          `Address: ${fullAddr || "none"}`,
          `Type: ${fmt(property.marketing_type)} / ${fmt(property.rs_type)}`,
          property.price ? `Price: ${fmtPrice(property.price)}` : null,
          property.base_rent ? `Base rent: ${fmtPrice(property.base_rent)}` : null,
          `Rooms: ${fmt(property.number_of_rooms)} | Space: ${fmtArea(property.living_space)}`,
          `Status: ${fmt(property.property_status?.name)}`,
          `Broker: ${fmt(property.broker?.name, "unassigned")}`,
          dom !== null ? `Days on market: ${dom}` : null,
          `Created: ${fmt(property.created_at)}`,
        ];
        sections.push(propLines.filter((l) => l !== null).join("\n"));

        // ── Deal/inquiry analysis
        if (dealsRes.status === "fulfilled") {
          const dealList = dealsRes.value.data ?? [];
          const totalInquiries = dealsRes.value.meta?.total_count ?? dealList.length;

          const byCategory: Record<string, number> = {};
          const byStage: Record<string, number> = {};
          let totalValue = 0;

          for (const d of dealList) {
            const cat = d.category ?? "unknown";
            byCategory[cat] = (byCategory[cat] ?? 0) + 1;

            const stage = String(d.deal_stage_id ?? "unknown");
            byStage[stage] = (byStage[stage] ?? 0) + 1;

            if (d.sold_price) totalValue += d.sold_price;
          }

          const dealLines: string[] = [
            "## Pipeline Analysis",
            "",
            `Total inquiries: ${totalInquiries}`,
          ];

          if (Object.keys(byCategory).length > 0) {
            dealLines.push("");
            dealLines.push("**By category:**");
            for (const [cat, count] of Object.entries(byCategory)) {
              dealLines.push(`  ${cat}: ${count}`);
            }
          }

          if (Object.keys(byStage).length > 0) {
            dealLines.push("");
            dealLines.push("**By stage ID:**");
            for (const [stage, count] of Object.entries(byStage)) {
              dealLines.push(`  Stage ${stage}: ${count}`);
            }
          }

          if (totalValue > 0) {
            dealLines.push("");
            dealLines.push(`Total deal value: ${fmtPrice(totalValue)}`);
          }

          if (dealList.length > 0) {
            dealLines.push("");
            dealLines.push("**Interested contacts:**");
            for (const d of dealList.slice(0, 10)) {
              const cName = d.client ? contactName(d.client) : `Contact #${d.client_id}`;
              dealLines.push(`  • ${cName} — Stage: ${fmt(d.deal_stage_id)}, Category: ${fmt(d.category)}`);
            }
          }

          sections.push(dealLines.join("\n"));
        } else {
          warnings.push("Deals");
          sections.push(`## Pipeline Analysis\nFailed to load: ${formatError(dealsRes.reason)}`);
        }

        // ── Activity breakdown
        if (activitiesRes.status === "fulfilled") {
          const activityList = activitiesRes.value.data ?? [];
          const totalActivities = activitiesRes.value.meta?.total_count ?? activityList.length;

          const byType: Record<string, number> = {};
          for (const a of activityList) {
            const t = a.type ?? "unknown";
            byType[t] = (byType[t] ?? 0) + 1;
          }

          const actLines: string[] = [
            "## Activity Summary",
            "",
            `Total activities: ${totalActivities} (showing last ${activityList.length})`,
          ];

          if (Object.keys(byType).length > 0) {
            actLines.push("");
            actLines.push("**By type:**");
            for (const [type, count] of Object.entries(byType)) {
              actLines.push(`  ${type}: ${count}`);
            }
          }

          if (activityList.length > 0) {
            actLines.push("");
            actLines.push("**Recent:**");
            for (const a of activityList.slice(0, 5)) {
              actLines.push(`  - ${fmt(a.type)} — ${fmt(a.title, "")} — ${fmt(a.created_at)}`);
            }
          }

          sections.push(actLines.join("\n"));
        } else {
          warnings.push("Activities");
          sections.push(`## Activity Summary\nFailed to load: ${formatError(activitiesRes.reason)}`);
        }

        if (warnings.length > 0) {
          sections.push(`\n**Note:** Some sections failed to load (${warnings.join(", ")}). The rest of the data is shown above.`);
        }

        return textResult(sections.join("\n\n---\n\n"));
      } catch (err) {
        return errorResult("Property report", err);
      }
    },
  );

  // ── pipeline_summary ────────────────────────────────────────────

  server.tool(
    "pipeline_summary",
    `Pipeline overview — deals per stage, total values, and stale deals
needing attention.

Fetches all deal pipelines and deals, then aggregates:
- Deal count per stage
- Total value per stage (from deal price or property price)
- Stale deals: deals with no update in 14+ days

Filter by pipeline_id and/or broker_id. Use when asked:
"How's the pipeline looking?" or "Give me a sales overview."`,
    {
      pipeline_id: z.number().optional()
        .describe("Filter by specific pipeline ID"),
      broker_id: z.number().optional()
        .describe("Filter by broker ID"),
    },
    async (args) => {
      try {
        const pipelinesRes = await client.get<PropstackDealPipeline[]>("/deal_pipelines").then(
          (v) => ({ status: "fulfilled" as const, value: v }),
          (e) => ({ status: "rejected" as const, reason: e }),
        );

        if (pipelinesRes.status === "rejected") {
          return errorResult("Pipeline summary", pipelinesRes.reason);
        }

        const pipelines = pipelinesRes.value;

        const dealParams: Record<string, string | number | boolean | undefined> = {
          include: "client,property",
          per_page: 100,
        };
        if (args.pipeline_id) dealParams["deal_pipeline_id"] = args.pipeline_id;
        if (args.broker_id) dealParams["broker_id"] = args.broker_id;

        const allDeals: PropstackDeal[] = [];
        let page = 1;
        let totalCount: number | undefined;
        const maxDeals = 2000;

        do {
          const res = await client.get<PropstackPaginatedResponse<PropstackDeal>>(
            "/client_properties",
            { params: { ...dealParams, page } },
          );
          if (res.data?.length) allDeals.push(...res.data);
          totalCount = res.meta?.total_count;
          page++;
        } while (
          allDeals.length < (totalCount ?? 0) &&
          allDeals.length < maxDeals
        );

        const warnings: string[] = [];
        if (totalCount !== undefined && allDeals.length >= maxDeals && totalCount > maxDeals) {
          warnings.push(`Summary capped at ${maxDeals} deals (${totalCount} total).`);
        }

        const deals = { data: allDeals, meta: totalCount !== undefined ? { total_count: totalCount } : undefined };

        const dealList = deals.data ?? [];
        const now = new Date();
        const staleThresholdMs = 14 * 24 * 60 * 60 * 1000;

        // Build stage name lookup
        const stageNames: Record<number, string> = {};
        const pipelineNames: Record<number, string> = {};
        for (const p of pipelines) {
          pipelineNames[p.id] = p.name ?? "Unnamed";
          if (p.deal_stages) {
            for (const s of p.deal_stages) {
              stageNames[s.id] = s.name ?? "Unnamed";
            }
          }
        }

        // Aggregate
        const stageStats: Record<string, { count: number; value: number; deals: PropstackDeal[] }> = {};
        const staleDeals: PropstackDeal[] = [];
        let totalDeals = 0;
        let totalValue = 0;

        for (const d of dealList) {
          totalDeals++;
          const stageName = d.deal_stage_id ? (stageNames[d.deal_stage_id] ?? `Stage #${d.deal_stage_id}`) : "No stage";
          if (!stageStats[stageName]) stageStats[stageName] = { count: 0, value: 0, deals: [] };
          stageStats[stageName]!.count++;

          const price = unwrapNumber(d.sold_price) ?? unwrapNumber(d.property?.price) ?? 0;
          stageStats[stageName]!.value += price;
          totalValue += price;
          stageStats[stageName]!.deals.push(d);

          // Check staleness
          const lastUpdate = d.updated_at ?? d.created_at;
          if (lastUpdate && (now.getTime() - new Date(lastUpdate).getTime()) > staleThresholdMs) {
            staleDeals.push(d);
          }
        }

        const sections: string[] = [];

        // Header
        const filterInfo: string[] = [];
        if (args.pipeline_id) filterInfo.push(`Pipeline: ${pipelineNames[args.pipeline_id] ?? args.pipeline_id}`);
        if (args.broker_id) filterInfo.push(`Broker ID: ${args.broker_id}`);
        const filterStr = filterInfo.length ? ` (${filterInfo.join(", ")})` : "";

        sections.push(
          `# Pipeline Summary${filterStr}\n\n` +
          `Total deals: ${deals.meta?.total_count ?? totalDeals}\n` +
          `Total value: ${fmtPrice(totalValue)}`,
        );

        // Stage breakdown
        if (Object.keys(stageStats).length > 0) {
          const stageLines: string[] = ["## Deals by Stage", ""];
          stageLines.push("| Stage | Deals | Value |");
          stageLines.push("|---|---|---|");
          for (const [stage, stats] of Object.entries(stageStats)) {
            stageLines.push(`| ${stage} | ${stats.count} | ${fmtPrice(stats.value)} |`);
          }
          sections.push(stageLines.join("\n"));
        }

        // Stale deals
        if (staleDeals.length > 0) {
          const staleLines: string[] = [`## Stale Deals (no update in 14+ days): ${staleDeals.length}`, ""];
          for (const d of staleDeals.slice(0, 10)) {
            const cName = d.client ? contactName(d.client) : `Contact #${d.client_id}`;
            const propTitle = d.property ? fmt(d.property.title, "Untitled") : `Property #${d.property_id}`;
            const daysStale = d.updated_at ? daysBetween(d.updated_at, now) : "?";
            const stageName = d.deal_stage_id ? (stageNames[d.deal_stage_id] ?? `#${d.deal_stage_id}`) : "none";
            staleLines.push(`- **Deal #${d.id}**: ${cName} → ${propTitle} (Stage: ${stageName}, ${daysStale} days since update)`);
          }
          sections.push(staleLines.join("\n"));
        } else {
          sections.push("## Stale Deals\nNo stale deals — all deals were updated within the last 14 days.");
        }

        if (warnings.length > 0) {
          sections.push(`\n**Note:** ${warnings.join(". ")}`);
        }

        return textResult(sections.join("\n\n---\n\n"));
      } catch (err) {
        return errorResult("Pipeline summary", err);
      }
    },
  );

  // ── smart_lead_intake ───────────────────────────────────────────

  server.tool(
    "smart_lead_intake",
    `Complete lead intake workflow — dedup check, create/update contact,
log notes, create deal if specific property, and set follow-up reminder.

Perfect for post-call processing from a voice agent. Handles the entire
intake in one tool call:

1. If phone or email provided → search for existing contact (dedup)
2. If found → update contact; if not → create new contact
3. If notes provided → log as a note task
4. If property_id provided → create deal at first pipeline stage
5. Create follow-up reminder for broker (due tomorrow 9am)

Returns what was done: created vs updated, IDs of all created records.`,
    {
      first_name: z.string()
        .describe("Contact first name"),
      last_name: z.string()
        .describe("Contact last name"),
      phone: z.string().optional()
        .describe("Phone number (also used for dedup search)"),
      email: z.string().optional()
        .describe("Email address (also used for dedup search)"),
      source_id: z.number().optional()
        .describe("Lead source ID (use get_contact_sources to look up)"),
      broker_id: z.number().optional()
        .describe("Assigned broker ID"),
      notes: z.string().optional()
        .describe("Call notes or free-text about the interaction"),
      property_interest: z.string().optional()
        .describe("Free text about what the lead is looking for (logged as note, not parsed into search profile)"),
      property_id: z.number().optional()
        .describe("Specific property ID the lead is interested in (creates a deal)"),
    },
    async (args) => {
      try {
        let contactId: number | undefined;
        let action: "created" | "updated" = "created";

        // Step 1: Dedup search
        if (args.phone || args.email) {
          const searchParams: Record<string, string | undefined> = {};
          if (args.phone) searchParams["phone_number"] = args.phone;
          if (args.email) searchParams["email"] = args.email;

          const existing = await client.get<PropstackPaginatedResponse<PropstackContact>>(
            "/contacts",
            { params: searchParams },
          );

          if (existing.data && existing.data.length > 0) {
            contactId = existing.data[0]!.id;
            action = "updated";
          }
        }

        // Step 2: Create or update contact
        const contactData: Record<string, unknown> = {
          first_name: args.first_name,
          last_name: args.last_name,
        };
        if (args.phone) contactData["phone"] = args.phone;
        if (args.email) contactData["email"] = args.email;
        if (args.source_id) contactData["client_source_id"] = args.source_id;
        if (args.broker_id) contactData["broker_id"] = args.broker_id;

        if (contactId) {
          await client.put<PropstackContact>(
            `/contacts/${contactId}`,
            { body: { client: contactData } },
          );
        } else {
          const created = await client.post<PropstackContact>(
            "/contacts",
            { body: { client: contactData } },
          );
          contactId = created.id;
        }

        // Step 3+: Parallel tasks — note, deal, reminder
        const parallelTasks: Promise<unknown>[] = [];
        let noteIdx = -1;
        let dealIdx = -1;
        let reminderIdx = -1;

        // Note
        const noteBody = [args.notes, args.property_interest ? `Interest: ${args.property_interest}` : null]
          .filter(Boolean)
          .join("\n\n");
        if (noteBody) {
          noteIdx = parallelTasks.length;
          parallelTasks.push(
            client.post<PropstackTask>("/tasks", {
              body: {
                task: {
                  title: `Lead intake: ${args.first_name} ${args.last_name}`,
                  body: noteBody,
                  client_ids: [contactId],
                  broker_id: args.broker_id,
                },
              },
            }),
          );
        }

        // Deal
        if (args.property_id) {
          // Get first pipeline stage
          const pipelines = await client.get<PropstackDealPipeline[]>("/deal_pipelines");
          const firstPipeline = pipelines[0];
          const firstStage = firstPipeline?.deal_stages?.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];

          if (firstStage) {
            dealIdx = parallelTasks.length;
            parallelTasks.push(
              client.post<PropstackDeal>("/client_properties", {
                body: {
                  client_property: {
                    client_id: contactId,
                    property_id: args.property_id,
                    deal_stage_id: firstStage.id,
                    deal_pipeline_id: firstPipeline!.id,
                    broker_id: args.broker_id,
                  },
                },
              }),
            );
          }
        }

        // Follow-up reminder (due tomorrow 9am)
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);

        reminderIdx = parallelTasks.length;
        parallelTasks.push(
          client.post<PropstackTask>("/tasks", {
            body: {
              task: {
                title: `Follow up: ${args.first_name} ${args.last_name}`,
                is_reminder: true,
                due_date: tomorrow.toISOString(),
                remind_at: tomorrow.toISOString(),
                done: false,
                client_ids: [contactId],
                property_ids: args.property_id ? [args.property_id] : undefined,
                broker_id: args.broker_id,
              },
            },
          }),
        );

        const results = await Promise.allSettled(parallelTasks);

        // Build response
        const lines: string[] = [
          `## Lead Intake Complete`,
          "",
          `Action: Contact **${action}**`,
          `Contact: ${args.first_name} ${args.last_name} (ID: ${contactId})`,
        ];

        if (noteIdx >= 0) {
          const noteRes = results[noteIdx]!;
          if (noteRes.status === "fulfilled") {
            const note = noteRes.value as PropstackTask;
            lines.push(`Note: logged (ID: ${note.id})`);
          } else {
            lines.push(`Note: failed to create — ${formatError(noteRes.reason)}`);
          }
        }

        if (dealIdx >= 0) {
          const dealRes = results[dealIdx]!;
          if (dealRes.status === "fulfilled") {
            const deal = dealRes.value as PropstackDeal;
            lines.push(`Deal: created (ID: ${deal.id}) for property ${args.property_id}`);
          } else {
            lines.push(`Deal: failed to create — ${formatError(dealRes.reason)}`);
          }
        }

        const reminderRes = results[reminderIdx]!;
        if (reminderRes.status === "fulfilled") {
          const reminder = reminderRes.value as PropstackTask;
          lines.push(`Follow-up: reminder set for ${tomorrow.toLocaleDateString("de-DE")} 09:00 (ID: ${reminder.id})`);
        } else {
          lines.push(`Follow-up: failed to create reminder — ${formatError(reminderRes.reason)}`);
        }

        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult("Lead intake", err);
      }
    },
  );

  // ── match_contacts_to_property ──────────────────────────────────

  server.tool(
    "match_contacts_to_property",
    `Find contacts whose search profiles match a property. Returns a
ranked list with match scores.

Use when a new listing comes in to find potential buyers/renters:
"Who should I send this new listing to?"

Logic:
1. Fetches the property details (type, price, rooms, space, city, features)
2. Fetches active search profiles (paginates, capped by max_profiles)
3. Scores each profile against the property on: marketing type, city,
   price range, room count, living space, property type, and features
4. Returns top 20 matches sorted by score with match/mismatch details`,
    {
      property_id: z.number()
        .describe("Property ID to find matching contacts for"),
      max_profiles: z.number().optional()
        .describe("Max search profiles to fetch and score (default: 1000). Caps API calls and memory for large accounts."),
    },
    async (args) => {
      try {
        // Step 1: Get property
        const property = await client.get<PropstackProperty>(
          `/units/${args.property_id}`,
        );

        // Step 2: Get search profiles (paginate, capped by max_profiles)
        const maxProfiles = args.max_profiles ?? 1000;
        const allProfiles: PropstackSearchProfile[] = [];
        let page = 1;
        let hasMore = true;
        while (hasMore && allProfiles.length < maxProfiles) {
          const res = await client.get<PropstackPaginatedResponse<PropstackSearchProfile>>(
            "/saved_queries",
            { params: { page, per_page: Math.min(100, maxProfiles - allProfiles.length) } },
          );
          if (res.data && res.data.length > 0) {
            allProfiles.push(...res.data);
            const total = res.meta?.total_count ?? 0;
            hasMore = allProfiles.length < total && allProfiles.length < maxProfiles;
            page++;
          } else {
            hasMore = false;
          }
        }

        if (allProfiles.length === 0) {
          return textResult("No search profiles found. Cannot match contacts.");
        }

        // Step 3: Score each profile
        interface MatchResult {
          profileId: number;
          clientId: number | null;
          score: number;
          maxScore: number;
          matches: string[];
          mismatches: string[];
        }

        const results: MatchResult[] = [];

        for (const sp of allProfiles) {
          if (!sp.active) continue;

          let score = 0;
          let maxScore = 0;
          const matches: string[] = [];
          const mismatches: string[] = [];

          // Marketing type (weight: 3)
          if (sp.marketing_type && property.marketing_type) {
            maxScore += 3;
            if (sp.marketing_type === property.marketing_type) {
              score += 3;
              matches.push(`Type: ${sp.marketing_type}`);
            } else {
              mismatches.push(`Type: wants ${sp.marketing_type}, property is ${property.marketing_type}`);
            }
          }

          // City (weight: 3)
          const propCity = fmt(property.city, "");
          if (sp.cities?.length && propCity) {
            maxScore += 3;
            if (sp.cities.some((c) => propCity.toLowerCase().includes(c.toLowerCase()))) {
              score += 3;
              matches.push(`City: ${propCity}`);
            } else {
              mismatches.push(`City: wants ${sp.cities.join("/")}, property in ${propCity}`);
            }
          }

          // Price range (weight: 2)
          const propPrice = unwrapNumber(property.price);
          if ((sp.price !== null || sp.price_to !== null) && propPrice !== null) {
            maxScore += 2;
            const inRange =
              (sp.price === null || sp.price === undefined || propPrice >= sp.price) &&
              (sp.price_to === null || sp.price_to === undefined || propPrice <= sp.price_to);
            if (inRange) {
              score += 2;
              matches.push(`Price: ${fmtPrice(property.price)} in range`);
            } else {
              mismatches.push(`Price: ${fmtPrice(property.price)} outside ${fmtPrice(sp.price)}–${fmtPrice(sp.price_to)}`);
            }
          }

          // Rent range (weight: 2)
          const propRent = unwrapNumber(property.base_rent);
          if ((sp.base_rent !== null || sp.base_rent_to !== null) && propRent !== null) {
            maxScore += 2;
            const inRange =
              (sp.base_rent === null || sp.base_rent === undefined || propRent >= sp.base_rent) &&
              (sp.base_rent_to === null || sp.base_rent_to === undefined || propRent <= sp.base_rent_to);
            if (inRange) {
              score += 2;
              matches.push(`Rent: ${fmtPrice(property.base_rent)} in range`);
            } else {
              mismatches.push(`Rent: ${fmtPrice(property.base_rent)} outside ${fmtPrice(sp.base_rent)}–${fmtPrice(sp.base_rent_to)}`);
            }
          }

          // Rooms (weight: 2)
          const propRooms = unwrapNumber(property.number_of_rooms);
          if ((sp.number_of_rooms !== null || sp.number_of_rooms_to !== null) && propRooms !== null) {
            maxScore += 2;
            const inRange =
              (sp.number_of_rooms === null || sp.number_of_rooms === undefined || propRooms >= sp.number_of_rooms) &&
              (sp.number_of_rooms_to === null || sp.number_of_rooms_to === undefined || propRooms <= sp.number_of_rooms_to);
            if (inRange) {
              score += 2;
              matches.push(`Rooms: ${fmt(property.number_of_rooms)}`);
            } else {
              mismatches.push(`Rooms: ${fmt(property.number_of_rooms)} outside ${fmt(sp.number_of_rooms)}–${fmt(sp.number_of_rooms_to)}`);
            }
          }

          // Living space (weight: 1)
          const propSpace = unwrapNumber(property.living_space);
          if ((sp.living_space !== null || sp.living_space_to !== null) && propSpace !== null) {
            maxScore += 1;
            const inRange =
              (sp.living_space === null || sp.living_space === undefined || propSpace >= sp.living_space) &&
              (sp.living_space_to === null || sp.living_space_to === undefined || propSpace <= sp.living_space_to);
            if (inRange) {
              score += 1;
              matches.push(`Space: ${fmtArea(property.living_space)}`);
            } else {
              mismatches.push(`Space: ${fmtArea(property.living_space)} outside ${fmt(sp.living_space)}–${fmt(sp.living_space_to)} m²`);
            }
          }

          // Property type (weight: 2)
          const propRsType = fmt(property.rs_type, "");
          if (sp.rs_types?.length && propRsType) {
            maxScore += 2;
            if (sp.rs_types.includes(propRsType)) {
              score += 2;
              matches.push(`Property type: ${propRsType}`);
            } else {
              mismatches.push(`Property type: wants ${sp.rs_types.join("/")}, is ${propRsType}`);
            }
          }

          // Only include profiles that matched on at least 1 criterion
          if (score > 0) {
            results.push({
              profileId: sp.id,
              clientId: sp.client_id,
              score,
              maxScore,
              matches,
              mismatches,
            });
          }
        }

        // Sort by score descending
        results.sort((a, b) => b.score - a.score || a.mismatches.length - b.mismatches.length);

        const top = results.slice(0, 20);

        if (top.length === 0) {
          return textResult(
            `No matching search profiles found for property "${fmt(property.title, "Untitled")}" ` +
            `(${fmt(property.marketing_type)} ${fmt(property.rs_type)}, ${fmtPrice(property.price)}, ` +
            `${fmt(property.number_of_rooms)} rooms, ${fmt(property.city, "?")}).\n\n` +
            `Checked ${allProfiles.length} search profiles.`,
          );
        }

        const header = [
          `# Matching Contacts for: ${fmt(property.title, "Untitled")} (ID: ${property.id})`,
          `${fmt(property.marketing_type)} ${fmt(property.rs_type)} — ${fmtPrice(property.price)} — ${fmt(property.number_of_rooms)} rooms — ${fmt(property.city, "?")}`,
          "",
          `Found **${results.length}** matching profiles out of ${allProfiles.length} total (showing top ${top.length}):`,
          "",
        ].join("\n");

        const matchLines = top.map((m, i) => {
          const pct = m.maxScore > 0 ? Math.round((m.score / m.maxScore) * 100) : 0;
          return [
            `**${i + 1}. Contact #${m.clientId}** — Score: ${m.score}/${m.maxScore} (${pct}%) — Profile #${m.profileId}`,
            m.matches.length ? `  Matches: ${m.matches.join(", ")}` : null,
            m.mismatches.length ? `  Mismatches: ${m.mismatches.join(", ")}` : null,
          ].filter(Boolean).join("\n");
        });

        return textResult(header + matchLines.join("\n\n"));
      } catch (err) {
        return errorResult("Property matching", err);
      }
    },
  );
}
