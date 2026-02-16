import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type { PropstackContact, PropstackContactSource, PropstackPaginatedResponse } from "../types/propstack.js";
import { textResult, errorResult, fmt, stripUndefined } from "./helpers.js";

/**
 * Generate search variants for a phone number. Propstack normalizes spaces/dashes
 * but not +49 vs 0 (German formats). Try both to maximize match rate.
 */
function phoneSearchVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 0) return [phone];

  const variants: string[] = [phone];

  // German: 0xxx... <-> +49xxx...
  if (digits.startsWith("49") && digits.length >= 12) {
    const national = "0" + digits.slice(2);
    if (!variants.includes(national)) variants.push(national);
  }
  if (digits.startsWith("0") && digits.length >= 11) {
    const international = "+49" + digits.slice(1);
    if (!variants.includes(international)) variants.push(international);
  }

  return variants;
}

/** Propstack contacts API may return { data, meta } or a raw array depending on endpoint/params. */
function normalizeContactsResponse(
  raw: PropstackPaginatedResponse<PropstackContact> | PropstackContact[],
): PropstackPaginatedResponse<PropstackContact> {
  if (Array.isArray(raw)) {
    return { data: raw };
  }
  return raw;
}

// ── Response formatting ──────────────────────────────────────────────

const GDPR_LABELS = ["Keine Angabe", "Ignoriert", "Zugestimmt", "Widerrufen"] as const;

function stars(rating: number): string {
  const clamped = Math.max(0, Math.min(3, rating));
  return "★".repeat(clamped) + "☆".repeat(3 - clamped);
}

function formatContact(c: PropstackContact): string {
  const name = fmt(c.name) !== "none" ? fmt(c.name) : [fmt(c.first_name, ""), fmt(c.last_name, "")].filter(Boolean).join(" ");
  const lines: (string | null)[] = [
    `**${name || "Unnamed"}** (ID: ${c.id})`,
    `Email: ${fmt(c.email)}`,
    `Phone: ${fmt(c.phone ?? c.home_cell)}`,
    `Status: ${fmt(c.client_status?.name)}`,
    `Broker: ${fmt(c.broker?.name, "unassigned")}`,
    `Rating: ${stars(c.rating ?? 0)}`,
    `Last contact: ${fmt(c.last_contact_at_formatted, "never")}`,
    `GDPR: ${GDPR_LABELS[c.gdpr_status ?? 0] ?? "unknown"}`,
    fmt(c.warning_notice, "") ? `Warning: ${fmt(c.warning_notice)}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

// ── Tool registration ────────────────────────────────────────────────

export function registerContactTools(server: McpServer, client: PropstackClient): void {
  // ── search_contacts ──────────────────────────────────────────────

  server.tool(
    "search_contacts",
    `Search and filter contacts in Propstack CRM.

Use this tool to:
- Find contacts by name, email, or phone number
- List recent leads (sort by created_at desc)
- Find uncontacted leads (last_contact_at is null)
- Filter by broker assignment, status, tags, or GDPR status
- Search across all contact fields with 'q' parameter

The 'q' parameter searches across: first name, last name, all emails,
all addresses, and all phone numbers.

Phone search ('phone_number') ignores formatting — both 015712345678
and 0157-123-456-78 will match.

Returns paginated results. Use expand=true for full details including
custom fields.`,
    {
      q: z.string().optional()
        .describe("Fulltext search across name, email, address, phone"),
      phone_number: z.string().optional()
        .describe("Search by phone number (formatting-insensitive)"),
      email: z.string().optional()
        .describe("Search by email address"),
      broker_id: z.number().optional()
        .describe("Filter by assigned broker ID"),
      status: z.array(z.number()).optional()
        .describe("Filter by contact status IDs"),
      sources: z.array(z.number()).optional()
        .describe("Filter by lead source IDs (e.g. ImmoScout24, Website)"),
      group: z.array(z.number()).optional()
        .describe("Filter by tag/group IDs (Merkmale)"),
      not_in_group: z.array(z.number()).optional()
        .describe("Exclude contacts with these tag/group IDs"),
      gdpr_status: z.number().optional()
        .describe("GDPR status: 0=Keine Angabe, 1=Ignoriert, 2=Zugestimmt, 3=Widerrufen"),
      newsletter: z.boolean().optional()
        .describe("Filter by newsletter opt-in"),
      accept_contact: z.boolean().optional()
        .describe("Filter by contact permission"),
      owner: z.boolean().optional()
        .describe("Filter for property owners"),
      archived: z.string().optional()
        .describe("Archive filter: '-1' = all (including archived), '1' = archived only. Omit for non-archived only (default)."),
      language: z.array(z.string()).optional()
        .describe("Filter by language codes (e.g. 'de', 'en')"),
      home_countries: z.array(z.string()).optional()
        .describe("Filter by home country codes"),
      project_ids: z.array(z.number()).optional()
        .describe("Filter by associated project IDs"),
      created_at_from: z.string().optional()
        .describe("Filter contacts created after this date (ISO 8601)"),
      created_at_to: z.string().optional()
        .describe("Filter contacts created before this date (ISO 8601)"),
      updated_at_from: z.string().optional()
        .describe("Filter contacts updated after this date (ISO 8601)"),
      updated_at_to: z.string().optional()
        .describe("Filter contacts updated before this date (ISO 8601)"),
      sort_by: z.enum(["last_contact_at", "created_at", "updated_at", "first_name", "last_name"]).optional()
        .describe("Field to sort results by"),
      order: z.enum(["asc", "desc"]).optional()
        .describe("Sort order (default: desc)"),
      expand: z.boolean().optional()
        .describe("Include full details and custom fields"),
      include_children: z.boolean().optional()
        .describe("Include sub-contacts in results"),
      page: z.number().optional()
        .describe("Page number (default: 1)"),
      per_page: z.number().optional()
        .describe("Results per page (default: 25)"),
    },
    async (args) => {
      try {
        const raw = await client.get<PropstackPaginatedResponse<PropstackContact> | PropstackContact[]>(
          "/contacts",
          { params: args as Record<string, string | number | boolean | string[] | number[] | undefined> },
        );
        const res = normalizeContactsResponse(raw);

        if (!res.data || res.data.length === 0) {
          return textResult("No contacts found matching your criteria.");
        }

        const header = res.meta?.total_count !== undefined
          ? `Found ${res.meta.total_count} contacts (showing ${res.data.length}):\n\n`
          : `Found ${res.data.length} contacts:\n\n`;

        const formatted = res.data.map(formatContact).join("\n\n---\n\n");
        return textResult(header + formatted);
      } catch (err) {
        return errorResult("Contact", err);
      }
    },
  );

  // ── get_contact ──────────────────────────────────────────────────

  server.tool(
    "get_contact",
    `Get full details of a single contact by ID.

Use this tool to:
- View complete contact information before a call
- Check relationships, documents, and owned properties
- See sub-contacts (e.g. family members at same address)

Use 'include' to load related data in one request.`,
    {
      id: z.number()
        .describe("Contact ID"),
      include: z.string().optional()
        .describe("Comma-separated related data to include. Values: children (sub-contacts), documents, relationships, owned_properties. Example: 'children,documents'"),
    },
    async (args) => {
      try {
        const params: Record<string, string | undefined> = {};
        if (args.include) {
          params["include"] = args.include;
        }

        const contact = await client.get<PropstackContact>(
          `/contacts/${args.id}`,
          { params },
        );

        return textResult(formatContact(contact));
      } catch (err) {
        return errorResult("Contact", err);
      }
    },
  );

  // ── create_contact ───────────────────────────────────────────────

  server.tool(
    "create_contact",
    `Create a new contact in Propstack CRM.

Use this tool to:
- Register a new lead after a phone call
- Create a contact from a web form submission
- Add a new property owner

Auto-upserts: if a contact with the same email or old_crm_id already
exists, it will be updated instead of creating a duplicate.

Use get_contact_sources first to find valid source IDs.`,
    {
      first_name: z.string().optional()
        .describe("First name"),
      last_name: z.string().optional()
        .describe("Last name"),
      email: z.string().optional()
        .describe("Email address (also used for dedup/upsert matching)"),
      phone: z.string().optional()
        .describe("Phone number"),
      salutation: z.enum(["mr", "ms"]).optional()
        .describe("Salutation: mr (Herr) or ms (Frau)"),
      academic_title: z.string().optional()
        .describe("Academic title (e.g. 'Dr.', 'Prof.')"),
      company: z.string().optional()
        .describe("Company name"),
      position: z.string().optional()
        .describe("Job position/title"),
      description: z.string().optional()
        .describe("Free-text description or notes about the contact"),
      broker_id: z.number().optional()
        .describe("ID of the assigned broker/agent"),
      client_source_id: z.number().optional()
        .describe("Lead source ID (use get_contact_sources to look up)"),
      client_status_id: z.number().optional()
        .describe("Contact status ID"),
      language: z.string().optional()
        .describe("Language code (e.g. 'de', 'en')"),
      rating: z.number().optional()
        .describe("Contact rating: 0 (none) to 3 (top priority)"),
      newsletter: z.boolean().optional()
        .describe("Newsletter opt-in"),
      accept_contact: z.boolean().optional()
        .describe("Contact permission granted"),
      home_street: z.string().optional().describe("Home address: street"),
      home_house_number: z.string().optional().describe("Home address: house number"),
      home_zip_code: z.string().optional().describe("Home address: postal code"),
      home_city: z.string().optional().describe("Home address: city"),
      home_country: z.string().optional().describe("Home address: country code"),
      office_street: z.string().optional().describe("Office address: street"),
      office_house_number: z.string().optional().describe("Office address: house number"),
      office_zip_code: z.string().optional().describe("Office address: postal code"),
      office_city: z.string().optional().describe("Office address: city"),
      office_country: z.string().optional().describe("Office address: country code"),
      partial_custom_fields: z.record(z.string(), z.unknown()).optional()
        .describe("Custom field values as key-value pairs (use list_custom_fields to discover available fields)"),
      group_ids: z.array(z.number()).optional()
        .describe("Tag/group IDs to assign to this contact"),
    },
    async (args) => {
      try {
        const contact = await client.post<PropstackContact>(
          "/contacts",
          { body: { client: stripUndefined(args) } },
        );

        return textResult(`Contact created successfully.\n\n${formatContact(contact)}`);
      } catch (err) {
        return errorResult("Contact", err);
      }
    },
  );

  // ── update_contact ───────────────────────────────────────────────

  server.tool(
    "update_contact",
    `Update an existing contact in Propstack CRM.

Use this tool to:
- Update contact details after a call
- Change broker assignment
- Add or remove tags (Merkmale)
- Update GDPR status
- Change contact rating or status

Tag management options:
- group_ids: replaces ALL tags with this list
- add_group_ids: adds tags without removing existing ones
- sub_group_ids: removes specific tags

Only provide the fields you want to change.`,
    {
      id: z.number()
        .describe("Contact ID to update"),
      first_name: z.string().optional().describe("First name"),
      last_name: z.string().optional().describe("Last name"),
      email: z.string().optional().describe("Email address"),
      phone: z.string().optional().describe("Phone number"),
      salutation: z.enum(["mr", "ms"]).optional().describe("Salutation: mr (Herr) or ms (Frau)"),
      academic_title: z.string().optional().describe("Academic title (e.g. 'Dr.', 'Prof.')"),
      company: z.string().optional().describe("Company name"),
      position: z.string().optional().describe("Job position/title"),
      description: z.string().optional().describe("Free-text description or notes"),
      broker_id: z.number().optional().describe("ID of the assigned broker/agent"),
      client_source_id: z.number().optional().describe("Lead source ID"),
      client_status_id: z.number().optional().describe("Contact status ID"),
      language: z.string().optional().describe("Language code (e.g. 'de', 'en')"),
      rating: z.number().optional().describe("Contact rating: 0 (none) to 3 (top priority)"),
      newsletter: z.boolean().optional().describe("Newsletter opt-in"),
      accept_contact: z.boolean().optional().describe("Contact permission granted"),
      gdpr_status: z.number().optional().describe("GDPR status: 0=Keine Angabe, 1=Ignoriert, 2=Zugestimmt, 3=Widerrufen"),
      archived: z.boolean().optional().describe("Archive or unarchive the contact"),
      home_street: z.string().optional().describe("Home address: street"),
      home_house_number: z.string().optional().describe("Home address: house number"),
      home_zip_code: z.string().optional().describe("Home address: postal code"),
      home_city: z.string().optional().describe("Home address: city"),
      home_country: z.string().optional().describe("Home address: country code"),
      office_street: z.string().optional().describe("Office address: street"),
      office_house_number: z.string().optional().describe("Office address: house number"),
      office_zip_code: z.string().optional().describe("Office address: postal code"),
      office_city: z.string().optional().describe("Office address: city"),
      office_country: z.string().optional().describe("Office address: country code"),
      partial_custom_fields: z.record(z.string(), z.unknown()).optional()
        .describe("Custom field values as key-value pairs"),
      group_ids: z.array(z.number()).optional()
        .describe("Replace ALL tags with this list of tag IDs"),
      add_group_ids: z.array(z.number()).optional()
        .describe("Add these tag IDs without removing existing tags"),
      sub_group_ids: z.array(z.number()).optional()
        .describe("Remove these tag IDs from the contact"),
    },
    async (args) => {
      try {
        const { id, ...fields } = args;
        const contact = await client.put<PropstackContact>(
          `/contacts/${id}`,
          { body: { client: stripUndefined(fields) } },
        );

        return textResult(`Contact updated successfully.\n\n${formatContact(contact)}`);
      } catch (err) {
        return errorResult("Contact", err);
      }
    },
  );

  // ── delete_contact ───────────────────────────────────────────────

  server.tool(
    "delete_contact",
    `Delete a contact from Propstack CRM (soft delete).

The contact is moved to a 30-day recycle bin and can be restored.

Use this tool for:
- GDPR deletion requests (Art. 17 DSGVO)
- Removing duplicate contacts
- Cleaning up test data`,
    {
      id: z.number()
        .describe("Contact ID to delete"),
    },
    async (args) => {
      try {
        await client.delete(`/contacts/${args.id}`);
        return textResult(`Contact ${args.id} deleted (moved to recycle bin for 30 days).`);
      } catch (err) {
        return errorResult("Contact", err);
      }
    },
  );

  // ── get_contact_sources ──────────────────────────────────────────

  server.tool(
    "get_contact_sources",
    `List all available contact/lead sources in Propstack.

Returns the list of sources like "Immobilienscout 24", "Website",
"Empfehlung", etc. with their IDs.

Use this tool to look up valid source IDs before creating or updating
contacts with client_source_id.`,
    {},
    async () => {
      try {
        const sources = await client.get<PropstackContactSource[]>("/contact_sources");

        if (!sources || sources.length === 0) {
          return textResult("No contact sources configured.");
        }

        const lines = sources.map(
          (s) => `- **${s.name}** (ID: ${s.id})`,
        );
        return textResult(`Contact sources:\n\n${lines.join("\n")}`);
      } catch (err) {
        return errorResult("Contact", err);
      }
    },
  );

  // ── search_contacts_by_phone ─────────────────────────────────────

  server.tool(
    "search_contacts_by_phone",
    `Look up a contact by phone number.

This is the go-to tool for voice agent caller identification. When a call
comes in, use this tool with the caller's phone number to instantly find
the matching contact.

Phone matching ignores formatting — all of these find the same contact:
  015712345678, 0157-123-456-78, +49 157 12345678

Returns the matching contact(s) with key details. If no match is found,
the caller is unknown and you should create a new contact.`,
    {
      phone_number: z.string()
        .describe("Phone number to search for (any format — formatting is ignored)"),
    },
    async (args) => {
      try {
        const variants = phoneSearchVariants(args.phone_number);
        const seenIds = new Set<number>();
        const contacts: PropstackContact[] = [];

        for (const variant of variants) {
          const raw = await client.get<PropstackPaginatedResponse<PropstackContact> | PropstackContact[]>(
            "/contacts",
            { params: { phone_number: variant } },
          );
          const res = normalizeContactsResponse(raw);
          if (res.data?.length) {
            for (const c of res.data) {
              if (!seenIds.has(c.id)) {
                seenIds.add(c.id);
                contacts.push(c);
              }
            }
            break;
          }
        }

        if (contacts.length === 0) {
          return textResult(`No contact found for phone number ${args.phone_number}. This is an unknown caller.`);
        }

        if (contacts.length === 1) {
          return textResult(`Caller identified:\n\n${formatContact(contacts[0]!)}`);
        }

        const header = `Found ${contacts.length} contacts matching ${args.phone_number}:\n\n`;
        const formatted = contacts.map(formatContact).join("\n\n---\n\n");
        return textResult(header + formatted);
      } catch (err) {
        return errorResult("Contact", err);
      }
    },
  );
}
