import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type { PropstackTask } from "../types/propstack.js";
import { textResult, errorResult, fmt, stripUndefined } from "./helpers.js";

// ── Response formatting ──────────────────────────────────────────────

function taskMode(t: PropstackTask): string {
  if (t.reservation_reason_id) return "Cancellation (Absage)";
  if (t.is_event) return "Appointment (Termin)";
  if (t.is_reminder) return "To-do (Aufgabe)";
  return "Note (Notiz)";
}

function formatTask(t: PropstackTask): string {
  const lines: (string | null)[] = [
    `**${fmt(t.title, "Untitled")}** (ID: ${t.id})`,
    `Type: ${taskMode(t)}`,
    fmt(t.body, "") ? `Body: ${fmt(t.body)}` : null,
    `Broker: ${fmt(t.broker_id, "unassigned")}`,
  ];

  // To-do fields
  if (t.is_reminder) {
    lines.push(`Due: ${fmt(t.due_date, "no date")}`);
    lines.push(`Remind at: ${fmt(t.remind_at, "none")}`);
    lines.push(`Done: ${t.done ? "yes" : "no"}`);
  }

  // Event fields
  if (t.is_event) {
    lines.push(`Starts: ${fmt(t.starts_at)}`);
    lines.push(`Ends: ${fmt(t.ends_at)}`);
    lines.push(fmt(t.location, "") ? `Location: ${fmt(t.location)}` : null);
    lines.push(t.all_day ? `All day: yes` : null);
    lines.push(t.private ? `Private: yes` : null);
    lines.push(t.recurring ? `Recurring: yes (${fmt(t.rrule)})` : null);
  }

  // Cancellation
  if (t.reservation_reason_id) {
    lines.push(`Reason ID: ${t.reservation_reason_id}`);
  }

  // State
  if (t.state) {
    lines.push(`State: ${t.state}`);
  }

  // Linked entities
  if (t.client_ids?.length) lines.push(`Contact IDs: ${t.client_ids.join(", ")}`);
  if (t.property_ids?.length) lines.push(`Property IDs: ${t.property_ids.join(", ")}`);
  if (t.project_ids?.length) lines.push(`Project IDs: ${t.project_ids.join(", ")}`);

  // Include-expanded relations
  if (t.clients?.length) {
    const names = t.clients.map((c) => `${fmt(c.name) !== "none" ? fmt(c.name) : [fmt(c.first_name, ""), fmt(c.last_name, "")].filter(Boolean).join(" ") || "Unnamed"} (${c.id})`);
    lines.push(`Contacts: ${names.join(", ")}`);
  }
  if (t.units?.length) {
    const titles = t.units.map((u) => `${fmt(u.title, "Untitled")} (${u.id})`);
    lines.push(`Properties: ${titles.join(", ")}`);
  }
  if (t.projects?.length) {
    const titles = t.projects.map((p) => `${fmt(p.title ?? p.name, "Untitled")} (${p.id})`);
    lines.push(`Projects: ${titles.join(", ")}`);
  }

  // Timestamps
  lines.push(`Created: ${fmt(t.created_at)}`);
  lines.push(`Updated: ${fmt(t.updated_at)}`);

  return lines.filter(Boolean).join("\n");
}

// ── Tool registration ────────────────────────────────────────────────

export function registerTaskTools(server: McpServer, client: PropstackClient): void {
  // ── create_task ─────────────────────────────────────────────────

  server.tool(
    "create_task",
    `Create a task (note, to-do, appointment, or cancellation) in Propstack.

This is the central write endpoint for ALL activity types. The mode is
determined by which flags you set:

MODE 1 — Note (Notiz):
  Just provide title + body. No special flags needed.
  Example: log a call note after a conversation.

MODE 2 — To-do (Aufgabe):
  Set is_reminder: true + due_date.
  Example: "remind me to call Herr Müller back tomorrow"

MODE 3 — Appointment (Termin):
  Set is_event: true + starts_at + ends_at.
  Example: "schedule a viewing at Musterstr 12 at 3pm"

MODE 4 — Cancellation (Absage):
  Set reservation_reason_id to a valid reason.
  Example: "cancel deal — buyer withdrew financing"

Always link tasks to contacts/properties/projects via the *_ids arrays
so they appear in the correct activity feeds.

The body field accepts HTML content.`,
    {
      title: z.string()
        .describe("Task title / subject line"),
      body: z.string().optional()
        .describe("Task body (HTML allowed). Call notes, meeting minutes, etc."),
      note_type_id: z.number().optional()
        .describe("Activity type ID (e.g. for note, brief, SMS subtypes)"),
      broker_id: z.number().optional()
        .describe("ID of the assigned broker/agent"),

      // Linked entities
      client_ids: z.array(z.number()).optional()
        .describe("Contact IDs to link this task to"),
      property_ids: z.array(z.number()).optional()
        .describe("Property IDs to link this task to"),
      project_ids: z.array(z.number()).optional()
        .describe("Project IDs to link this task to"),

      // To-do (Aufgabe) fields
      is_reminder: z.boolean().optional()
        .describe("Set true to create a To-do/Aufgabe (MODE 2)"),
      due_date: z.string().optional()
        .describe("Due date for to-do (ISO 8601). Requires is_reminder: true"),
      remind_at: z.string().optional()
        .describe("Reminder notification time (ISO 8601). Requires is_reminder: true"),
      done: z.boolean().optional()
        .describe("Mark to-do as completed (default: false)"),

      // Appointment (Termin) fields
      is_event: z.boolean().optional()
        .describe("Set true to create an Appointment/Termin (MODE 3)"),
      starts_at: z.string().optional()
        .describe("Event start time (ISO 8601). Requires is_event: true"),
      ends_at: z.string().optional()
        .describe("Event end time (ISO 8601). Requires is_event: true"),
      location: z.string().optional()
        .describe("Event location (address or description)"),
      all_day: z.boolean().optional()
        .describe("All-day event flag"),
      private: z.boolean().optional()
        .describe("Private event — hidden from other brokers"),
      recurring: z.boolean().optional()
        .describe("Recurring event flag"),
      rrule: z.string().optional()
        .describe("iCal RRULE for recurring events (e.g. 'FREQ=WEEKLY;COUNT=4')"),

      // Cancellation (Absage) fields
      reservation_reason_id: z.number().optional()
        .describe("Cancellation reason ID — setting this activates MODE 4 (Absage)"),

      // State
      state: z.string().optional()
        .describe("Event state (e.g. 'neutral', 'took_place', 'cancelled')"),
    },
    async (args) => {
      try {
        const task = await client.post<PropstackTask>(
          "/tasks",
          { body: { task: stripUndefined(args) } },
        );

        return textResult(`Task created successfully.\n\n${formatTask(task)}`);
      } catch (err) {
        return errorResult("Task", err);
      }
    },
  );

  // ── update_task ─────────────────────────────────────────────────

  server.tool(
    "update_task",
    `Update an existing task in Propstack.

Use this tool to:
- Mark a to-do as done
- Reschedule an appointment (change starts_at/ends_at)
- Add notes to an existing task (update body)
- Change broker assignment
- Update event state (took_place, cancelled)
- Link additional contacts or properties

Only provide the fields you want to change.`,
    {
      id: z.number()
        .describe("Task ID to update"),
      title: z.string().optional()
        .describe("Task title / subject line"),
      body: z.string().optional()
        .describe("Task body (HTML allowed)"),
      note_type_id: z.number().optional()
        .describe("Activity type ID"),
      broker_id: z.number().optional()
        .describe("ID of the assigned broker/agent"),

      // Linked entities
      client_ids: z.array(z.number()).optional()
        .describe("Contact IDs to link this task to"),
      property_ids: z.array(z.number()).optional()
        .describe("Property IDs to link this task to"),
      project_ids: z.array(z.number()).optional()
        .describe("Project IDs to link this task to"),

      // To-do fields
      is_reminder: z.boolean().optional()
        .describe("To-do flag"),
      due_date: z.string().optional()
        .describe("Due date (ISO 8601)"),
      remind_at: z.string().optional()
        .describe("Reminder notification time (ISO 8601)"),
      done: z.boolean().optional()
        .describe("Mark to-do as completed"),

      // Appointment fields
      is_event: z.boolean().optional()
        .describe("Appointment flag"),
      starts_at: z.string().optional()
        .describe("Event start time (ISO 8601)"),
      ends_at: z.string().optional()
        .describe("Event end time (ISO 8601)"),
      location: z.string().optional()
        .describe("Event location"),
      all_day: z.boolean().optional()
        .describe("All-day event flag"),
      private: z.boolean().optional()
        .describe("Private event flag"),
      recurring: z.boolean().optional()
        .describe("Recurring event flag"),
      rrule: z.string().optional()
        .describe("iCal RRULE for recurring events"),

      // Cancellation
      reservation_reason_id: z.number().optional()
        .describe("Cancellation reason ID"),

      // State
      state: z.string().optional()
        .describe("Event state (e.g. 'neutral', 'took_place', 'cancelled')"),
    },
    async (args) => {
      try {
        const { id, ...fields } = args;
        const task = await client.put<PropstackTask>(
          `/tasks/${id}`,
          { body: { task: stripUndefined(fields) } },
        );

        return textResult(`Task updated successfully.\n\n${formatTask(task)}`);
      } catch (err) {
        return errorResult("Task", err);
      }
    },
  );

  // ── get_task ────────────────────────────────────────────────────

  server.tool(
    "get_task",
    `Get full details of a single task by ID.

Returns the task with all linked entities expanded (contacts, properties,
projects, viewings) by default.

Use this tool to:
- View full context of an activity before acting on it
- Check linked contacts and properties
- See appointment details (time, location, state)
- Check if a to-do has been completed`,
    {
      id: z.number()
        .describe("Task ID"),
      include: z.string().optional()
        .describe("Comma-separated related data to include (default: 'clients,units,projects,viewings')"),
    },
    async (args) => {
      try {
        const params: Record<string, string> = {
          include: args.include ?? "clients,units,projects,viewings",
        };

        const task = await client.get<PropstackTask>(
          `/tasks/${args.id}`,
          { params },
        );

        return textResult(formatTask(task));
      } catch (err) {
        return errorResult("Task", err);
      }
    },
  );
}
