import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type {
  PropstackActivity,
  PropstackActivityDetail,
  PropstackEvent,
  PropstackPaginatedResponse,
} from "../types/propstack.js";
import { textResult, errorResult, fmt, htmlToText, stripUndefined } from "./helpers.js";

/** Longest email/note body returned by get_activity before truncation. */
const MAX_BODY_CHARS = 8000;

// ── Response formatting ──────────────────────────────────────────────

/** Resolve activity type — Propstack API uses conversation_type (event, reminder, note, message, etc). */
function getActivityType(a: PropstackActivity): string {
  const t = fmt(a.conversation_type ?? a.type, "");
  if (t && t !== "none") return t;
  const rec = a as unknown as Record<string, unknown>;
  const uid = String(rec.unique_id ?? "");
  if (uid.startsWith("event-")) return "event";
  if (uid.startsWith("reminder-")) return "reminder";
  return "—";
}

/** "Name (ID: 1), Other (ID: 2)" from parallel id/name arrays. */
export function namedIds(ids: number[], names?: string[] | null): string {
  return ids.map((id, i) => (names?.[i] ? `${names[i]} (ID: ${id})` : `ID ${id}`)).join(", ");
}

function formatActivity(a: PropstackActivity): string {
  const lines: (string | null)[] = [
    `**${fmt(a.title, "Untitled")}** (ID: ${a.id})`,
    `Type: ${getActivityType(a)}${a.outgoing === true ? " (outgoing)" : a.outgoing === false && getActivityType(a) === "message" ? " (incoming)" : ""}`,
    fmt(a.body, "") ? `Body: ${fmt(a.body)}` : null,
    a.broker ? `Broker: ${fmt(a.broker.name)}` : (a.broker_id ? `Broker ID: ${a.broker_id}` : null),
  ];

  if (a.client_ids?.length) {
    lines.push(`Contacts: ${namedIds(a.client_ids, a.client_names)}`);
  } else if (a.client) {
    const name = fmt(a.client.name) !== "none" ? fmt(a.client.name) : [fmt(a.client.first_name, ""), fmt(a.client.last_name, "")].filter(Boolean).join(" ") || "Unnamed";
    lines.push(`Contact: ${name} (ID: ${a.client.id})`);
  } else if (a.client_id) {
    lines.push(`Contact ID: ${a.client_id}`);
  }

  if (a.property_ids?.length) {
    lines.push(`Properties: ${namedIds(a.property_ids, a.property_names)}`);
  } else if (a.property) {
    lines.push(`Property: ${fmt(a.property.title, "Untitled")} (ID: ${a.property.id})`);
  } else if (a.property_id) {
    lines.push(`Property ID: ${a.property_id}`);
  }

  if (a.project_ids?.length) {
    lines.push(`Projects: ${namedIds(a.project_ids, a.project_names)}`);
  } else if (a.project_id) {
    lines.push(`Project ID: ${a.project_id}`);
  }
  if (a.starts_at) lines.push(`Starts: ${a.starts_at}`);
  if (a.attachments_count) lines.push(`Attachments: ${a.attachments_count}`);
  lines.push(`Date: ${fmt(a.created_at)}`);

  return lines.filter(Boolean).join("\n");
}

function formatEvent(e: PropstackEvent): string {
  const lines: (string | null)[] = [
    `**${fmt(e.title, "Untitled")}** (ID: ${e.id})`,
    `Starts: ${fmt(e.starts_at)}`,
    `Ends: ${fmt(e.ends_at)}`,
    `State: ${fmt(e.state)}`,
    fmt(e.location, "") ? `Location: ${fmt(e.location)}` : null,
    e.all_day ? `All day: yes` : null,
    e.private ? `Private: yes` : null,
    e.recurring ? `Recurring: yes (${fmt(e.rrule)})` : null,
    e.broker_id ? `Broker ID: ${e.broker_id}` : null,
  ];

  if (e.client) {
    const name = fmt(e.client.name) !== "none" ? fmt(e.client.name) : [fmt(e.client.first_name, ""), fmt(e.client.last_name, "")].filter(Boolean).join(" ") || "Unnamed";
    lines.push(`Contact: ${name} (ID: ${e.client.id})`);
  }

  if (e.property) {
    lines.push(`Property: ${fmt(e.property.title, "Untitled")} (ID: ${e.property.id})`);
  }

  if (fmt(e.body, "")) lines.push(`Notes: ${fmt(e.body)}`);

  return lines.filter(Boolean).join("\n");
}

/** Render GET /activities/:id — the email, task or policy inside the activity. */
export function formatActivityDetail(detail: PropstackActivityDetail): string {
  const kind = fmt(detail.activatable_type, "Unknown");
  const item = detail.activatable ?? {};
  const get = (k: string) => (item as Record<string, unknown>)[k];
  const list = (k: string) => {
    const v = get(k);
    return Array.isArray(v) && v.length ? v.map(String).join(", ") : null;
  };
  const ids = (k: string) => {
    const v = get(k);
    return Array.isArray(v) && v.length ? v.join(", ") : null;
  };

  const lines: (string | null)[] = [`# Activity ${detail.id} (${kind})`];

  if (kind === "Message") {
    lines.push(
      `**${fmt(get("subject"), "No subject")}** (email ID: ${fmt(get("id"))})`,
      `From: ${list("from") ?? fmt(get("from"))}`,
      `To: ${list("to") ?? "none"}`,
      list("cc") ? `CC: ${list("cc")}` : null,
      get("broker_id") ? `Broker ID: ${fmt(get("broker_id"))}` : null,
      get("read") !== undefined ? `Read: ${get("read") ? "yes" : "no"}` : null,
    );
  } else {
    lines.push(
      `**${fmt(get("title"), "Untitled")}** (ID: ${fmt(get("id"))})`,
      get("broker_id") ? `Broker ID: ${fmt(get("broker_id"))}` : null,
      get("starts_at") ? `Starts: ${fmt(get("starts_at"))}` : null,
      get("due_date") ? `Due: ${fmt(get("due_date"))}` : null,
      get("done") !== undefined && get("done") !== null ? `Done: ${get("done") ? "yes" : "no"}` : null,
    );
  }

  if (ids("client_ids")) lines.push(`Contact IDs: ${ids("client_ids")}`);
  if (ids("property_ids")) lines.push(`Property IDs: ${ids("property_ids")}`);
  if (ids("project_ids")) lines.push(`Project IDs: ${ids("project_ids")}`);

  const attachments = get("attachments");
  if (Array.isArray(attachments) && attachments.length) {
    const names = attachments.map((a) =>
      fmt((a as Record<string, unknown>)?.["name"], "unnamed"));
    lines.push(`Attachments: ${names.join(", ")}`);
  }
  lines.push(`Date: ${fmt(get("created_at"))}`);

  const rawBody = get("body") ?? get("body_plain");
  let body = htmlToText(typeof rawBody === "string" ? rawBody : null);
  if (body) {
    if (body.length > MAX_BODY_CHARS) {
      body = `${body.slice(0, MAX_BODY_CHARS)}\n\n[… truncated, ${body.length - MAX_BODY_CHARS} more characters]`;
    }
    lines.push("", "## Content", "", body);
  }

  return lines.filter((l) => l !== null).join("\n");
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
- letter: Letters (Briefe)

Use list_activity_types to see all valid types for this account.

To read emails: filter with type "message" (optionally only_inquiries for
portal/website inquiries and a date range), then open one with
get_activity to see the full email text.`,
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
      only_inquiries: z.boolean().optional()
        .describe("Only inquiries (Anfragen), e.g. from portals or the website"),
      not_completed: z.boolean().optional()
        .describe("Only activities that are not completed (open to-dos)"),
      created_from: z.string().optional()
        .describe("Created at or after (ISO 8601, e.g. '2026-11-01T00:00:00+01:00')"),
      created_to: z.string().optional()
        .describe("Created at or before (ISO 8601)"),
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
        const { type, created_from, created_to, ...rest } = args;
        // The API filters by item_type and original_created_at_*; sending
        // "type" was silently ignored and returned every activity type.
        const params = stripUndefined({
          ...rest,
          item_type: type,
          original_created_at_from: created_from,
          original_created_at_to: created_to,
        });
        const res = await client.get<PropstackPaginatedResponse<PropstackActivity>>(
          "/activities",
          { params: params as Record<string, string | number | boolean | undefined> },
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

  // ── get_activity ────────────────────────────────────────────────

  server.tool(
    "get_activity",
    `Open a single activity from search_activities and show its full content.

For emails (incoming or outgoing) this returns subject, sender, recipients,
linked contacts/properties and the email text (HTML converted to plain
text, long bodies truncated). For notes, to-dos and appointments it returns
the task details.

Use this to read inbound emails and inquiries, e.g. after
search_activities with type "message". Email content is personal data:
only fetch what the task needs.`,
    {
      id: z.number()
        .describe("Activity ID (from search_activities)"),
    },
    async (args) => {
      try {
        const detail = await client.get<PropstackActivityDetail>(`/activities/${args.id}`);
        return textResult(formatActivityDetail(detail));
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
- See what's scheduled this week (starts_at_after/starts_at_before)
- List upcoming viewings for a broker (broker=ID)
- Find cancelled appointments (state="cancelled")
- Check recurring events
- Filter by contact (client=ID) or property (property=ID)
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
      tag: z.number().optional()
        .describe("Filter by tag/group ID (Merkmal)"),
      broker: z.number().optional()
        .describe("Filter by broker ID"),
      client: z.number().optional()
        .describe("Filter by contact ID"),
      property: z.number().optional()
        .describe("Filter by property ID"),
      project: z.number().optional()
        .describe("Filter by project ID"),
      note_type: z.number().optional()
        .describe("Filter by event category/type ID"),
      starts_at_after: z.string().optional()
        .describe("Events starting after this date/time (ISO 8601, e.g. '2025-01-01')"),
      starts_at_before: z.string().optional()
        .describe("Events starting before this date/time (ISO 8601, e.g. '2025-12-31')"),
      ends_at_after: z.string().optional()
        .describe("Events ending after this date/time (ISO 8601)"),
      ends_at_before: z.string().optional()
        .describe("Events ending before this date/time (ISO 8601)"),
      page: z.number().optional()
        .describe("Page number (default: 1)"),
      per_page: z.number().optional()
        .describe("Results per page (default: 25)"),
    },
    async (args) => {
      try {
        const raw = await client.get<{ events: PropstackEvent[]; meta?: { total_count: number } }>(
          "/events",
          { params: args as Record<string, string | number | boolean | undefined> },
        );
        const events = raw.events ?? [];

        if (events.length === 0) {
          return textResult("No events found matching your criteria.");
        }

        const header = raw.meta?.total_count !== undefined
          ? `Found ${raw.meta.total_count} events (showing ${events.length}):\n\n`
          : `Found ${events.length} events:\n\n`;

        const formatted = events.map(formatEvent).join("\n\n---\n\n");
        return textResult(header + formatted);
      } catch (err) {
        return errorResult("Event", err);
      }
    },
  );
}
