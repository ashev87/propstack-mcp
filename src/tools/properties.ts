import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type { PropstackProperty, PropstackPropertyStatus, PropstackPaginatedResponse } from "../types/propstack.js";
import { textResult, errorResult, fmt, stripUndefined } from "./helpers.js";

// ── Response formatting ──────────────────────────────────────────────

function fmtPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return "none";
  return value.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

function fmtArea(value: number | null | undefined, unit = "m²"): string {
  if (value === null || value === undefined) return "none";
  return `${value} ${unit}`;
}

function formatProperty(p: PropstackProperty): string {
  const title = fmt(p.title, "Untitled");
  const marketingType = fmt(p.marketing_type);
  const rsType = fmt(p.rs_type);

  const address = [p.street, p.house_number].filter(Boolean).join(" ");
  const cityLine = [p.zip_code, p.city].filter(Boolean).join(" ");
  const fullAddress = [address, cityLine, p.country].filter(Boolean).join(", ");

  const lines: (string | null)[] = [
    `**${title}** (ID: ${p.id})`,
    `Type: ${marketingType} / ${rsType}${p.rs_category ? ` / ${p.rs_category}` : ""}`,
    `Address: ${fullAddress || "none"}`,
    marketingType === "BUY" || p.price ? `Price: ${fmtPrice(p.price)}` : null,
    marketingType === "RENT" || p.base_rent ? `Base rent: ${fmtPrice(p.base_rent)}` : null,
    p.total_rent ? `Total rent: ${fmtPrice(p.total_rent)}` : null,
    `Living space: ${fmtArea(p.living_space)}`,
    p.plot_area ? `Plot area: ${fmtArea(p.plot_area)}` : null,
    `Rooms: ${fmt(p.number_of_rooms)}`,
    p.number_of_bed_rooms ? `Bedrooms: ${p.number_of_bed_rooms}` : null,
    p.number_of_bath_rooms ? `Bathrooms: ${p.number_of_bath_rooms}` : null,
    p.floor !== undefined && p.floor !== null ? `Floor: ${p.floor}` : null,
    p.construction_year ? `Built: ${p.construction_year}` : null,
    `Status: ${fmt(p.property_status?.name)}`,
    `Broker: ${fmt(p.broker?.name, "unassigned")}`,
    p.project ? `Project: ${fmt(p.project.name)}` : null,
    p.exposee_id ? `Exposé ID: ${p.exposee_id}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

function formatPropertyRow(p: PropstackProperty): string {
  const addr = [p.street, p.house_number].filter(Boolean).join(" ");
  const city = [p.zip_code, p.city].filter(Boolean).join(" ");
  const location = [addr, city].filter(Boolean).join(", ") || "—";
  const price = p.price
    ? p.price.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
    : p.base_rent
      ? p.base_rent.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }) + "/mo"
      : "—";
  const size = p.living_space ? `${p.living_space} m²` : "—";
  const rooms = p.number_of_rooms != null ? `${p.number_of_rooms}R` : "—";
  const status = p.property_status?.name ?? "—";
  const type = [p.marketing_type, p.rs_type].filter(Boolean).join("/");

  return `| ${p.id} | ${fmt(p.title, "—")} | ${type} | ${location} | ${price} | ${size} | ${rooms} | ${status} |`;
}

// ── Shared enums ─────────────────────────────────────────────────────

const RS_TYPES = [
  "APARTMENT", "HOUSE", "TRADE_SITE", "GARAGE",
  "SHORT_TERM_ACCOMODATION", "OFFICE", "GASTRONOMY",
  "INDUSTRY", "STORE", "SPECIAL_PURPOSE", "INVESTMENT",
] as const;

const OBJECT_TYPES = ["LIVING", "COMMERCIAL", "INVESTMENT"] as const;

const SEARCH_SORT_FIELDS = [
  "exposee_id", "construction_year", "unit_id.raw", "floor",
  "created_at", "property_space_value", "plot_area", "base_rent",
  "price", "object_price", "price_per_sqm", "property_status_position",
  "street_number.raw", "sold_date", "total_rent", "number_of_rooms",
  "updated_at",
] as const;

// ── Tool registration ────────────────────────────────────────────────

export function registerPropertyTools(server: McpServer, client: PropstackClient): void {
  // ── search_properties ────────────────────────────────────────────

  server.tool(
    "search_properties",
    `Search and filter properties (Objekte) in Propstack CRM.

Use this tool to:
- Find properties by address, ID, or exposé ID (use 'q' for fulltext)
- Filter by status, type, marketing type, or project
- Find properties in a price/rent range
- List properties by size, rooms, or construction year
- Filter by custom fields with cf_ prefix parameters

The 'q' parameter searches: unit_id, street, zip code, city, district, exposé ID.

Range filter pattern: 11 numeric fields each have _from and _to variants.
For example, price_from=200000 & price_to=400000 finds properties priced 200–400k.
Available range fields: price, base_rent, total_rent, property_space_value,
living_space, plot_area, number_of_rooms, number_of_bed_rooms,
number_of_bath_rooms, floor, construction_year.

Common queries:
- "Apartments 300–400k in Berlin": q="Berlin", marketing_type=BUY, rs_type=APARTMENT, price_from=300000, price_to=400000
- "All available rentals": marketing_type=RENT, status=<available_id from get_property_statuses>
- "Properties on market 90+ days": sort_by=created_at, order=asc
- "What's in Project X?": project_id=<id>

Always returns total count. Use expand=true for custom fields.`,
    {
      q: z.string().optional()
        .describe("Fulltext search across unit_id, street, zip, city, district, exposé ID"),
      status: z.string().optional()
        .describe("Comma-separated property status IDs (use get_property_statuses to look up)"),
      marketing_type: z.enum(["BUY", "RENT"]).optional()
        .describe("Filter by marketing type: BUY (Kauf) or RENT (Miete)"),
      rs_type: z.enum(RS_TYPES).optional()
        .describe("Property type filter"),
      object_type: z.enum(OBJECT_TYPES).optional()
        .describe("Object category: LIVING (Wohnen), COMMERCIAL (Gewerbe), INVESTMENT (Anlage)"),
      country: z.string().optional()
        .describe("Filter by country code (e.g. 'DE')"),
      project_id: z.number().optional()
        .describe("Filter by project ID"),
      group: z.number().optional()
        .describe("Filter by tag/group ID (Merkmal)"),
      archived: z.string().optional()
        .describe("Archive filter: '-1' = all (including archived), '1' = archived only. Omit for non-archived only (default)."),
      property_ids: z.array(z.number()).optional()
        .describe("Filter to specific property IDs"),
      include_variants: z.boolean().optional()
        .describe("Include property variants"),
      exact: z.boolean().optional()
        .describe("Use exact matching for text search"),
      // Range filters
      price_from: z.number().optional().describe("Minimum purchase price (EUR)"),
      price_to: z.number().optional().describe("Maximum purchase price (EUR)"),
      base_rent_from: z.number().optional().describe("Minimum base rent (EUR/month)"),
      base_rent_to: z.number().optional().describe("Maximum base rent (EUR/month)"),
      total_rent_from: z.number().optional().describe("Minimum total rent (EUR/month)"),
      total_rent_to: z.number().optional().describe("Maximum total rent (EUR/month)"),
      property_space_value_from: z.number().optional().describe("Minimum property space (m²)"),
      property_space_value_to: z.number().optional().describe("Maximum property space (m²)"),
      living_space_from: z.number().optional().describe("Minimum living space (m²)"),
      living_space_to: z.number().optional().describe("Maximum living space (m²)"),
      plot_area_from: z.number().optional().describe("Minimum plot area (m²)"),
      plot_area_to: z.number().optional().describe("Maximum plot area (m²)"),
      number_of_rooms_from: z.number().optional().describe("Minimum number of rooms"),
      number_of_rooms_to: z.number().optional().describe("Maximum number of rooms"),
      number_of_bed_rooms_from: z.number().optional().describe("Minimum bedrooms"),
      number_of_bed_rooms_to: z.number().optional().describe("Maximum bedrooms"),
      number_of_bath_rooms_from: z.number().optional().describe("Minimum bathrooms"),
      number_of_bath_rooms_to: z.number().optional().describe("Maximum bathrooms"),
      floor_from: z.number().optional().describe("Minimum floor"),
      floor_to: z.number().optional().describe("Maximum floor"),
      construction_year_from: z.number().optional().describe("Built after this year"),
      construction_year_to: z.number().optional().describe("Built before this year"),
      // Sorting & pagination
      sort_by: z.enum(SEARCH_SORT_FIELDS).optional()
        .describe("Field to sort results by (default: unit_id)"),
      order: z.enum(["asc", "desc"]).optional()
        .describe("Sort order (default: desc)"),
      expand: z.boolean().optional()
        .describe("Include full details and custom fields"),
      page: z.number().optional()
        .describe("Page number (default: 1)"),
      per_page: z.number().optional()
        .describe("Results per page (default: 25)"),
    },
    async (args) => {
      try {
        const params: Record<string, string | number | boolean | string[] | number[] | undefined> = {
          with_meta: 1,
          ...args,
        };

        const res = await client.get<PropstackPaginatedResponse<PropstackProperty>>(
          "/units",
          { params },
        );

        if (!res.data || res.data.length === 0) {
          return textResult("No properties found matching your criteria.");
        }

        const total = res.meta?.total_count;
        const header = total !== undefined
          ? `Found ${total} properties (showing ${res.data.length}):\n\n`
          : `Found ${res.data.length} properties:\n\n`;

        const tableHeader = "| ID | Title | Type | Address | Price | Size | Rooms | Status |\n| --- | --- | --- | --- | --- | --- | --- | --- |";
        const rows = res.data.map(formatPropertyRow).join("\n");
        return textResult(header + tableHeader + "\n" + rows);
      } catch (err) {
        return errorResult("Property", err);
      }
    },
  );

  // ── get_property ─────────────────────────────────────────────────

  server.tool(
    "get_property",
    `Get full details of a single property by ID.

Use this tool to:
- View complete property information for an exposé
- Check images, floorplans, documents, and links
- See custom fields, broker assignment, and project
- Get multilingual texts (use locale parameter)

Always fetches with new=1 (extra fields) and expand=1 (custom fields).`,
    {
      id: z.number()
        .describe("Property ID"),
      include_translations: z.string().optional()
        .describe("Comma-separated language codes for multilingual texts (e.g. 'en,de'). Omit for default language only."),
    },
    async (args) => {
      try {
        const params: Record<string, string | number | boolean | undefined> = {
          new: 1,
          expand: 1,
        };
        if (args.include_translations) {
          params["include_translations"] = args.include_translations;
        }

        const property = await client.get<PropstackProperty>(
          `/units/${args.id}`,
          { params },
        );

        let result = formatProperty(property);

        // Append description texts if present
        const descriptions: string[] = [];
        if (property.description_note) descriptions.push(`**Description:** ${property.description_note}`);
        if (property.location_note) descriptions.push(`**Location:** ${property.location_note}`);
        if (property.furnishing_note) descriptions.push(`**Furnishing:** ${property.furnishing_note}`);
        if (property.other_note) descriptions.push(`**Other:** ${property.other_note}`);
        if (descriptions.length > 0) {
          result += "\n\n" + descriptions.join("\n\n");
        }

        // Append images summary
        if (property.images && property.images.length > 0) {
          result += `\n\nImages: ${property.images.length} attached`;
        }

        // Append documents summary
        if (property.documents && property.documents.length > 0) {
          result += `\nDocuments: ${property.documents.length} attached`;
        }

        // Append links
        if (property.links && property.links.length > 0) {
          const linkLines = property.links.map(
            (l) => `  - ${fmt(l.title, "Link")}: ${fmt(l.url)}`,
          );
          result += `\nLinks:\n${linkLines.join("\n")}`;
        }

        // Append custom fields summary
        if (property.custom_fields && Object.keys(property.custom_fields).length > 0) {
          const cfEntries = Object.entries(property.custom_fields)
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => `  - ${k}: ${v}`);
          if (cfEntries.length > 0) {
            result += `\n\nCustom fields:\n${cfEntries.join("\n")}`;
          }
        }

        return textResult(result);
      } catch (err) {
        return errorResult("Property", err);
      }
    },
  );

  // ── create_property ──────────────────────────────────────────────

  server.tool(
    "create_property",
    `Create a new property (Objekt) in Propstack CRM.

Use this tool to:
- List a new property from an acquisition call
- Create a listing from an owner inquiry
- Add a property to a project

Use get_property_statuses to look up valid status IDs.
Use the relationships_attributes array to link an owner contact on creation.

rs_type values: APARTMENT, HOUSE, TRADE_SITE, GARAGE, SHORT_TERM_ACCOMODATION,
OFFICE, GASTRONOMY, INDUSTRY, STORE, SPECIAL_PURPOSE, INVESTMENT.

rs_category provides sub-types (e.g. PENTHOUSE, VILLA, MAISONETTE for APARTMENT/HOUSE).`,
    {
      title: z.string().optional()
        .describe("Property title / headline"),
      marketing_type: z.enum(["BUY", "RENT"]).optional()
        .describe("Marketing type: BUY (Kauf) or RENT (Miete)"),
      object_type: z.enum(OBJECT_TYPES).optional()
        .describe("Object category: LIVING, COMMERCIAL, or INVESTMENT"),
      rs_type: z.enum(RS_TYPES).optional()
        .describe("Property type (e.g. APARTMENT, HOUSE, OFFICE)"),
      rs_category: z.string().optional()
        .describe("Property sub-type (e.g. PENTHOUSE, VILLA, MAISONETTE, SINGLE_FAMILY_HOUSE)"),
      // Address
      street: z.string().optional().describe("Street name"),
      house_number: z.string().optional().describe("House number"),
      zip_code: z.string().optional().describe("Postal code"),
      city: z.string().optional().describe("City"),
      country: z.string().optional().describe("Country code (e.g. 'DE')"),
      lat: z.number().optional().describe("Latitude"),
      lng: z.number().optional().describe("Longitude"),
      // Pricing
      price: z.number().optional().describe("Purchase price (EUR)"),
      base_rent: z.number().optional().describe("Base rent (EUR/month)"),
      total_rent: z.number().optional().describe("Total rent including utilities (EUR/month)"),
      // Dimensions
      living_space: z.number().optional().describe("Living space (m²)"),
      plot_area: z.number().optional().describe("Plot area (m²)"),
      number_of_rooms: z.number().optional().describe("Number of rooms"),
      number_of_bed_rooms: z.number().optional().describe("Number of bedrooms"),
      number_of_bath_rooms: z.number().optional().describe("Number of bathrooms"),
      floor: z.number().optional().describe("Floor number"),
      construction_year: z.number().optional().describe("Year of construction"),
      // Texts
      description_note: z.string().optional().describe("Property description text (HTML allowed)"),
      location_note: z.string().optional().describe("Location description text"),
      furnishing_note: z.string().optional().describe("Furnishing/equipment description text"),
      other_note: z.string().optional().describe("Additional notes text"),
      // Commission
      courtage: z.string().optional().describe("Commission amount or percentage"),
      courtage_note: z.string().optional().describe("Commission details/notes"),
      // Assignment
      broker_id: z.number().optional().describe("Assigned broker ID"),
      project_id: z.number().optional().describe("Project ID this property belongs to"),
      status: z.number().optional().describe("Property status ID (use get_property_statuses to look up)"),
      // Custom fields & relationships
      partial_custom_fields: z.record(z.string(), z.unknown()).optional()
        .describe("Custom field values as key-value pairs"),
      relationships_attributes: z.array(z.object({
        internal_name: z.string().describe('Relationship type (e.g. "owner")'),
        related_client_id: z.number().describe("Contact ID to link"),
      })).optional()
        .describe('Link contacts on creation, e.g. [{internal_name: "owner", related_client_id: 123}]'),
    },
    async (args) => {
      try {
        const property = await client.post<PropstackProperty>(
          "/units",
          { body: { property: stripUndefined(args) } },
        );

        return textResult(`Property created successfully.\n\n${formatProperty(property)}`);
      } catch (err) {
        return errorResult("Property", err);
      }
    },
  );

  // ── update_property ──────────────────────────────────────────────

  server.tool(
    "update_property",
    `Update an existing property in Propstack CRM.

Use this tool to:
- Update the price or rent
- Change property status (e.g. mark as reserved or sold)
- Edit description texts
- Assign to a different broker or project
- Update custom fields

Only provide the fields you want to change.
Use get_property_statuses to look up valid status IDs.`,
    {
      id: z.number()
        .describe("Property ID to update"),
      title: z.string().optional().describe("Property title / headline"),
      marketing_type: z.enum(["BUY", "RENT"]).optional().describe("Marketing type: BUY or RENT"),
      object_type: z.enum(OBJECT_TYPES).optional().describe("Object category"),
      rs_type: z.enum(RS_TYPES).optional().describe("Property type"),
      rs_category: z.string().optional().describe("Property sub-type"),
      street: z.string().optional().describe("Street name"),
      house_number: z.string().optional().describe("House number"),
      zip_code: z.string().optional().describe("Postal code"),
      city: z.string().optional().describe("City"),
      country: z.string().optional().describe("Country code"),
      lat: z.number().optional().describe("Latitude"),
      lng: z.number().optional().describe("Longitude"),
      price: z.number().optional().describe("Purchase price (EUR)"),
      base_rent: z.number().optional().describe("Base rent (EUR/month)"),
      total_rent: z.number().optional().describe("Total rent (EUR/month)"),
      living_space: z.number().optional().describe("Living space (m²)"),
      plot_area: z.number().optional().describe("Plot area (m²)"),
      number_of_rooms: z.number().optional().describe("Number of rooms"),
      number_of_bed_rooms: z.number().optional().describe("Number of bedrooms"),
      number_of_bath_rooms: z.number().optional().describe("Number of bathrooms"),
      floor: z.number().optional().describe("Floor number"),
      construction_year: z.number().optional().describe("Year of construction"),
      description_note: z.string().optional().describe("Property description text"),
      location_note: z.string().optional().describe("Location description text"),
      furnishing_note: z.string().optional().describe("Furnishing description text"),
      other_note: z.string().optional().describe("Additional notes text"),
      courtage: z.string().optional().describe("Commission amount or percentage"),
      courtage_note: z.string().optional().describe("Commission details"),
      broker_id: z.number().optional().describe("Assigned broker ID"),
      project_id: z.number().optional().describe("Project ID"),
      status: z.number().optional().describe("Property status ID (use get_property_statuses)"),
      partial_custom_fields: z.record(z.string(), z.unknown()).optional()
        .describe("Custom field values as key-value pairs"),
    },
    async (args) => {
      try {
        const { id, ...fields } = args;
        const property = await client.put<PropstackProperty>(
          `/units/${id}`,
          { body: { property: stripUndefined(fields) } },
        );

        return textResult(`Property updated successfully.\n\n${formatProperty(property)}`);
      } catch (err) {
        return errorResult("Property", err);
      }
    },
  );

  // ── get_property_statuses ────────────────────────────────────────

  server.tool(
    "get_property_statuses",
    `List all available property statuses in Propstack.

Returns statuses like "Verfügbar", "Reserviert", "Verkauft" with their IDs,
colors, and sort positions.

Use this tool to look up valid status IDs before:
- Filtering properties by status in search_properties
- Setting a property's status in create_property or update_property`,
    {},
    async () => {
      try {
        const statuses = await client.get<PropstackPropertyStatus[]>("/property_statuses");

        if (!statuses || statuses.length === 0) {
          return textResult("No property statuses configured.");
        }

        const lines = statuses.map((s) => {
          const nonpublic = s.nonpublic ? " (non-public)" : "";
          return `- **${s.name}** (ID: ${s.id})${nonpublic}`;
        });
        return textResult(`Property statuses:\n\n${lines.join("\n")}`);
      } catch (err) {
        return errorResult("Property status", err);
      }
    },
  );
}
