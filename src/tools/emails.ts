import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type { PropstackEmail, PropstackPaginatedResponse } from "../types/propstack.js";
import {
  textResult, errorResult, fmt, stripUndefined,
  validateFields, renderProjectedRecord, EMAIL_FIELDS,
} from "./helpers.js";

const toolError = (text: string) => ({ ...textResult(text), isError: true as const });

// ── Reading emails (via the activity feed) ───────────────────────────
//
// The public V1 API documents no GET on /messages. Emails are read through
// the activity feed instead: GET /activities?item_type=message lists them,
// and GET /activities/:id returns the email object as `activatable`.

/** An email entry in the activity feed (GET /activities, item_type=message). */
interface EmailActivity {
  id: number;
  title?: string | null;
  broker_id?: number | null;
  client_ids?: number[] | null;
  property_ids?: number[] | null;
  project_ids?: number[] | null;
  /** false = received (inbound), true = sent. */
  outgoing?: boolean | null;
  attachments_count?: number | null;
  created_at?: string | null;
}

/** GET /activities/:id — container around a Message, Task or Policy. */
interface ActivityDetail {
  id: number;
  activatable_type?: string | null;
  activatable?: Record<string, unknown> | null;
}

/** Longest email body returned by get_email, in characters. */
const MAX_BODY_CHARS = 8000;

/** Email bodies are HTML; reduce them to readable text. */
function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>(\s*)/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function bodyText(body: unknown): string | null {
  if (typeof body !== "string" || body.trim() === "") return null;
  const text = htmlToText(body);
  if (text.length <= MAX_BODY_CHARS) return text;
  return `${text.slice(0, MAX_BODY_CHARS)}\n[… truncated, ${text.length - MAX_BODY_CHARS} more characters]`;
}

/** Addresses come back as an array (documented) or a single string. */
function addressList(value: unknown): string | null {
  if (Array.isArray(value)) return value.length ? value.join(", ") : null;
  if (typeof value === "string" && value !== "") return value;
  return null;
}

function idList(value: unknown): string | null {
  return Array.isArray(value) && value.length ? value.join(", ") : null;
}

function formatEmailListItem(a: EmailActivity): string {
  const lines: (string | null)[] = [
    `**${fmt(a.title, "No subject")}** (activity ID: ${a.id})`,
    `Received: ${fmt(a.created_at)}`,
    a.broker_id ? `Broker ID: ${a.broker_id}` : null,
    idList(a.client_ids) ? `Contact IDs: ${idList(a.client_ids)}` : null,
    idList(a.property_ids) ? `Property IDs: ${idList(a.property_ids)}` : null,
    idList(a.project_ids) ? `Project IDs: ${idList(a.project_ids)}` : null,
    a.attachments_count ? `Attachments: ${a.attachments_count}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

// ── Response formatting ──────────────────────────────────────────────

function formatEmail(e: PropstackEmail): string {
  const lines: (string | null)[] = [
    `**${fmt(e.subject, "No subject")}** (ID: ${e.id})`,
    `From: ${fmt(e.from)}`,
    `To: ${e.to?.join(", ") ?? "none"}`,
    e.cc?.length ? `CC: ${e.cc.join(", ")}` : null,
    e.bcc?.length ? `BCC: ${e.bcc.join(", ")}` : null,
    `Broker ID: ${fmt(e.broker_id)}`,
    e.snippet_id ? `Template ID: ${e.snippet_id}` : null,
    `Read: ${e.read ? "yes" : "no"}`,
    `Archived: ${e.archived ? "yes" : "no"}`,
    e.message_category_id ? `Category ID: ${e.message_category_id}` : null,
  ];

  if (e.client_ids?.length) lines.push(`Contact IDs: ${e.client_ids.join(", ")}`);
  if (e.property_ids?.length) lines.push(`Property IDs: ${e.property_ids.join(", ")}`);
  if (e.project_ids?.length) lines.push(`Project IDs: ${e.project_ids.join(", ")}`);
  if (e.attachments?.length) {
    lines.push(`Attachments: ${e.attachments.map((a) => fmt(a.name, "unnamed")).join(", ")}`);
  }

  lines.push(`Date: ${fmt(e.created_at)}`);

  return lines.filter(Boolean).join("\n");
}

// ── Tool registration ────────────────────────────────────────────────

export function registerEmailTools(server: McpServer, client: PropstackClient): void {
  // ── send_email ──────────────────────────────────────────────────

  server.tool(
    "send_email",
    `Send an email using a Propstack email template (snippet).

Propstack sends emails through connected broker email accounts. The
broker_id determines which account sends the email. The snippet_id
selects the email template to use.

Use this tool to:
- Send an exposé to an interested contact
- Send a follow-up email after a viewing
- Send a confirmation or rejection to a lead

Link the email to contacts, properties, and projects so it appears
in the correct CRM activity feeds.

Important:
- broker_id must be a broker with a connected email account
- snippet_id is the email template ID — the template may contain
  merge fields that Propstack fills automatically (contact name,
  property details, etc.)
- to[] are the recipient email addresses
- cc[] are optional CC recipients`,
    {
      broker_id: z.number()
        .describe("Sender broker ID (must have connected email account)"),
      to: z.array(z.string())
        .describe("Recipient email addresses"),
      snippet_id: z.number()
        .describe("Email template (snippet) ID"),
      cc: z.array(z.string()).optional()
        .describe("CC recipient email addresses"),
      client_ids: z.array(z.number()).optional()
        .describe("Contact IDs to link this email to"),
      property_ids: z.array(z.number()).optional()
        .describe("Property IDs to link this email to"),
      project_ids: z.array(z.number()).optional()
        .describe("Project IDs to link this email to"),
    },
    async (args) => {
      try {
        const email = await client.post<PropstackEmail>(
          "/messages",
          { body: { message: stripUndefined(args) } },
        );

        return textResult(`Email sent successfully.\n\n${formatEmail(email)}`);
      } catch (err) {
        return errorResult("Email", err);
      }
    },
  );

  // ── update_email ────────────────────────────────────────────────

  server.tool(
    "update_email",
    `Update an email in Propstack.

Use this tool to:
- Mark an email as read or unread
- Archive an email
- Categorize an email (set message_category_id)
- Link an email to contacts, properties, or projects

Only provide the fields you want to change.`,
    {
      id: z.number()
        .describe("Email/message ID to update"),
      read: z.boolean().optional()
        .describe("Mark as read (true) or unread (false)"),
      archived: z.boolean().optional()
        .describe("Archive (true) or unarchive (false)"),
      message_category_id: z.number().optional()
        .describe("Email category ID"),
      client_ids: z.array(z.number()).optional()
        .describe("Contact IDs to link this email to"),
      property_ids: z.array(z.number()).optional()
        .describe("Property IDs to link this email to"),
      project_ids: z.array(z.number()).optional()
        .describe("Project IDs to link this email to"),
    },
    async (args) => {
      try {
        const { id, ...fields } = args;
        const email = await client.put<PropstackEmail>(
          `/messages/${id}`,
          { body: { message: stripUndefined(fields) } },
        );

        return textResult(`Email updated successfully.\n\n${formatEmail(email)}`);
      } catch (err) {
        return errorResult("Email", err);
      }
    },
  );

  // ── list_inbound_emails ─────────────────────────────────────────

  server.tool(
    "list_inbound_emails",
    `List emails received in Propstack (inbound messages), newest first.

Use this tool to:
- See what a contact has written (client_id)
- See incoming inquiries and replies about a property (property_id)
- Check a broker's received mail (broker_id)

Returns only the subject, date and linked contact / property / project IDs
of each email. Sender addresses and the email text are personal data and are
deliberately left out; call get_email with the activity ID to read one
message.

Propstack has no server-side "inbound only" filter, so each page of the
email feed is fetched and sent emails are dropped. A page can therefore
hold fewer results than "per", or none: request the next page to continue.`,
    {
      client_id: z.number().optional()
        .describe("Only emails linked to this contact"),
      property_id: z.number().optional()
        .describe("Only emails linked to this property"),
      project_id: z.number().optional()
        .describe("Only emails linked to this project"),
      broker_id: z.number().optional()
        .describe("Only emails of this broker's mailbox"),
      page: z.number().optional()
        .describe("Page number (default: 1)"),
      per: z.number().optional()
        .describe("Emails fetched per page, before sent emails are dropped (default: 20)"),
    },
    async (args) => {
      try {
        const res = await client.get<PropstackPaginatedResponse<EmailActivity>>(
          "/activities",
          { params: { ...stripUndefined(args), item_type: "message", order: "desc" } },
        );

        const all = res.data ?? [];
        const page = args.page ?? 1;
        if (all.length === 0) {
          return textResult(page > 1
            ? `No more emails (page ${page} is empty).`
            : "No emails found matching your criteria.");
        }

        // Direction is only known from the documented `outgoing` flag. If the
        // API stops sending it, fail loudly rather than report "no inbound".
        if (!all.some((a) => typeof a.outgoing === "boolean")) {
          return toolError(
            "Propstack returned emails without the 'outgoing' flag, so inbound " +
            "emails cannot be told apart from sent ones. Use search_activities " +
            "with type 'message' instead.",
          );
        }

        const inbound = all.filter((a) => a.outgoing === false);
        const total = res.meta?.total_count;
        const scope = total !== undefined
          ? `page ${page}: ${all.length} of ${total} emails (sent and received) checked`
          : `page ${page}: ${all.length} emails (sent and received) checked`;
        const more = total !== undefined && page * (args.per ?? 20) < total
          ? `\n\nMore emails may follow: request page ${page + 1}.`
          : "";

        if (inbound.length === 0) {
          return textResult(`No inbound emails on this page (${scope}).${more}`);
        }

        return textResult(
          `${inbound.length} inbound emails (${scope}):\n\n` +
          inbound.map(formatEmailListItem).join("\n\n---\n\n") +
          more,
        );
      } catch (err) {
        return errorResult("Activity", err);
      }
    },
  );

  // ── get_email ───────────────────────────────────────────────────

  server.tool(
    "get_email",
    `Read a single email (received or sent) by its activity ID.

Use the activity IDs from list_inbound_emails or from search_activities
with type "message". The result also shows the message ID, which is the ID
update_email expects.

The result contains personal data (addresses and the email text). Use
"fields" to fetch only what the task needs, e.g. ["subject", "client_ids"]
to check what an email is linked to without reading its content. Without
"fields" you get subject, sender, recipients, linked IDs and the text.

The body is converted from HTML to plain text and cut off after
${MAX_BODY_CHARS} characters. BCC and attachment IDs are only returned when
requested through "fields".`,
    {
      activity_id: z.number()
        .describe("Activity ID of the email (from list_inbound_emails or search_activities)"),
      fields: z.array(z.string()).optional()
        .describe(`Return only these fields. Valid: ${EMAIL_FIELDS.join(", ")}`),
    },
    async (args) => {
      try {
        if (args.fields && args.fields.length > 0) {
          const fieldError = validateFields(args.fields, EMAIL_FIELDS, "email");
          if (fieldError) return toolError(fieldError);
        }

        const activity = await client.get<ActivityDetail>(`/activities/${args.activity_id}`);

        if (activity.activatable_type !== "Message" || !activity.activatable) {
          return toolError(
            `Activity ${args.activity_id} is not an email ` +
            `(type: ${fmt(activity.activatable_type, "unknown")}).`,
          );
        }

        const e: Record<string, unknown> = {
          ...activity.activatable,
          body: bodyText(activity.activatable.body),
        };
        const header = `**Email** (activity ID: ${activity.id}, message ID: ${fmt(e.id)})`;

        if (args.fields && args.fields.length > 0) {
          return textResult(renderProjectedRecord(e, args.fields, header));
        }

        const lines: (string | null)[] = [
          header,
          `Subject: ${fmt(e.subject, "No subject")}`,
          `From: ${addressList(e.from) ?? "none"}`,
          `To: ${addressList(e.to) ?? "none"}`,
          addressList(e.cc) ? `CC: ${addressList(e.cc)}` : null,
          e.broker_id ? `Broker ID: ${fmt(e.broker_id)}` : null,
          idList(e.client_ids) ? `Contact IDs: ${idList(e.client_ids)}` : null,
          idList(e.property_ids) ? `Property IDs: ${idList(e.property_ids)}` : null,
          idList(e.project_ids) ? `Project IDs: ${idList(e.project_ids)}` : null,
          e.message_category_id ? `Category ID: ${fmt(e.message_category_id)}` : null,
          `\n${fmt(e.body, "(no text)")}`,
        ];
        return textResult(lines.filter(Boolean).join("\n"));
      } catch (err) {
        return errorResult("Activity", err);
      }
    },
  );
}
