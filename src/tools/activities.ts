import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type { PropstackActivity, PropstackEvent, PropstackPaginatedResponse } from "../types/propstack.js";
import { textResult, errorResult, fmt } from "./helpers.js";

// ── Response formatting ──────────────────────────────────────────────

function formatActivity(a: PropstackActivity): string {
  const lines: (string | null)[] = [
    `**${fmt(a.title, "Untitled")}** (ID: ${a.id})`,
    `Type: ${fmt(a.type)}`,
    a.body ? `Body: ${a.body}` : null,
    a.broker ? `Broker: ${a.broker.name}` : (a.broker_id ? `Broker ID: ${a.broker_id}` : null),
  ];

  if (a.client) {
    const name = a.client.name ?? [a.client.first_name, a.client.last_name].filter(Boolean).join(" ");
    lines.push(`Contact: ${name} (ID: ${a.client.id})`);
  } else if (a.client_id) {
    lines.push(`Contact ID: ${a.client_id}`);
  }

  if (a.property) {
    lines.push(`Property: ${fmt(a.property.title, "Untitled")} (ID: ${a.property.id})`);
  } else if (a.property_id) {
    lines.push(`Property ID: ${a.property_id}`);
  }

  if (a.project_id) lines.push(`Project ID: ${a.project_id}`);
  lines.push(`Date: ${fmt(a.created_at)}`);

  return lines.filter(Boolean).join("\n");
}

function formatEvent(e: PropstackEvent): string {
  const lines: (string | null)[] = [
    `**${fmt(e.title, "Untitled")}** (ID: ${e.id})`,
    `Starts: ${fmt(e.starts_at)}`,
    `Ends: ${fmt(e.ends_at)}`,
    `State: ${fmt(e.state)}`,
    e.location ? `Location: ${e.location}` : null,
    e.all_day ? `All day: yes` : null,
    e.private ? `Private: yes` : null,
    e.recurring ? `Recurring: yes (${fmt(e.rrule)})` : null,
    e.broker_id ? `Broker ID: ${e.broker_id}` : null,
  ];

  if (e.client) {
    const name = e.client.name ?? [e.client.first_name, e.client.last_name].filter(Boolean).join(" ");
    lines.push(`Contact: ${name} (ID: ${e.client.id})`);
  }

  if (e.property) {
    lines.push(`Property: ${fmt(e.property.title, "Untitled")} (ID: ${e.property.id})`);
  }

  if (e.body) lines.push(`Notes: ${e.body}`);

  return lines.filter(Boolean).join("\n");
}

// ── Tool registration ────────────────────────────────────────────────

export function registerActivityTools(server: McpServer, client: PropstackClient): void {
  // ── search_activities ───────────────────────────────────────────

  server.tool(
    "search_activities",
    `Search the activity feed/timeline in Propstack.

Activities are the read-only feed of everything that happened: emails
sent, notes logged, tasks created, events scheduled, cancellations,
GDPR policy changes, etc.

Use this tool to:
- View the full interaction history for a contact (client_id)
- See all activity on a property (property_id)
- Track what a broker has been doing (broker_id)
- Filter by activity type to find specific interactions
- Answer "what happened with this contact/property this week?"

Activity types:
- message: Emails sent/received
- note: Call notes, comments
- reminder: To-do items (Aufgaben)
- event: Appointments (Termine)
- policy: GDPR consent changes
- cancelation: Deal cancellations (Absagen)
- decision: Deal decisions
- sms: SMS messages
- letter: Letters (Briefe)`,
    {
      type: z.enum(["message", "note", "reminder", "event", "policy", "cancelation", "decision", "sms", "letter"]).optional()
        .describe("Filter by activity type"),
      broker_id: z.number().optional()
        .describe("Filter by broker ID"),
      client_id: z.number().optional()
        .describe("Filter by contact ID — show all activity for this contact"),
      property_id: z.number().optional()
        .describe("Filter by property ID — show all activity for this property"),
      project_id: z.number().optional()
        .describe("Filter by project ID"),
      sort_by: z.string().optional()
        .describe("Field to sort by"),
      order: z.enum(["asc", "desc"]).optional()
        .describe("Sort order (default: desc)"),
      page: z.number().optional()
        .describe("Page number (default: 1)"),
      per: z.number().optional()
        .describe("Results per page (default: 20)"),
    },
    async (args) => {
      try {
        const res = await client.get<PropstackPaginatedResponse<PropstackActivity>>(
          "/activities",
          { params: args as Record<string, string | number | boolean | undefined> },
        );

        if (!res.data || res.data.length === 0) {
          return textResult("No activities found matching your criteria.");
        }

        const header = res.meta?.total_count !== undefined
          ? `Found ${res.meta.total_count} activities (showing ${res.data.length}):\n\n`
          : `Found ${res.data.length} activities:\n\n`;

        const formatted = res.data.map(formatActivity).join("\n\n---\n\n");
        return textResult(header + formatted);
      } catch (err) {
        return errorResult("Activity", err);
      }
    },
  );

  // ── list_events ─────────────────────────────────────────────────

  server.tool(
    "list_events",
    `List calendar events (Termine) in Propstack.

Events are appointments like property viewings, client meetings,
notary appointments, etc.

Use this tool to:
- See what's scheduled this week (starts_at_from/to)
- List upcoming viewings for a broker
- Find cancelled appointments (state="cancelled")
- Check recurring events
- Answer "what viewings are scheduled this week?"

Event states:
- neutral: Scheduled, not yet happened
- took_place: Completed
- cancelled: Was cancelled`,
    {
      recurring: z.boolean().optional()
        .describe("Filter for recurring events only"),
      state: z.enum(["neutral", "took_place", "cancelled"]).optional()
        .describe("Event state: neutral (scheduled), took_place, cancelled"),
      group_id: z.number().optional()
        .describe("Filter by tag/group ID"),
      broker_id: z.number().optional()
        .describe("Filter by broker ID"),
      starts_at_from: z.string().optional()
        .describe("Events starting after this date/time (ISO 8601)"),
      starts_at_to: z.string().optional()
        .describe("Events starting before this date/time (ISO 8601)"),
      page: z.number().optional()
        .describe("Page number (default: 1)"),
      per_page: z.number().optional()
        .describe("Results per page (default: 25)"),
    },
    async (args) => {
      try {
        const res = await client.get<PropstackPaginatedResponse<PropstackEvent>>(
          "/events",
          { params: args as Record<string, string | number | boolean | undefined> },
        );

        if (!res.data || res.data.length === 0) {
          return textResult("No events found matching your criteria.");
        }

        const header = res.meta?.total_count !== undefined
          ? `Found ${res.meta.total_count} events (showing ${res.data.length}):\n\n`
          : `Found ${res.data.length} events:\n\n`;

        const formatted = res.data.map(formatEvent).join("\n\n---\n\n");
        return textResult(header + formatted);
      } catch (err) {
        return errorResult("Event", err);
      }
    },
  );
}
