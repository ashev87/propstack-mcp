import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type { PropstackEmail } from "../types/propstack.js";
import { textResult, errorResult, fmt, stripUndefined } from "./helpers.js";

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
}
