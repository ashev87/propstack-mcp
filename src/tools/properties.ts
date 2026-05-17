import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type { PropstackProperty, PropstackPropertyStatus, PropstackPaginatedResponse } from "../types/propstack.js";
import { textResult, errorResult, fmt, fmtPrice, fmtArea, stripUndefined, unwrapPropstackValue } from "./helpers.js";

// ── Response formatting ──────────────────────────────────────────────

function fmtList(value: unknown): string {
  const v = unwrapPropstackValue(value);
  if (Array.isArray(v)) {
    const items = v.map((item) => fmt(item, "")).filter(Boolean);
    return items.length > 0 ? items.join(", ") : "none";
  }
  return fmt(v);
}

function fmtYesNo(value: unknown): string {
  const v = unwrapPropstackValue(value);
  if (typeof v === "boolean") return v ? "yes" : "no";
  return fmt(v);
}

function formatSection(
  title: string,
  rows: Array<[label: string, value: unknown, formatter?: (value: unknown) => string]>,
): string | null {
  const lines = rows
    .map(([label, value, formatter = fmt]) => {
      const formatted = formatter(value);
      return formatted === "none" ? null : `  - ${label}: ${formatted}`;
    })
    .filter((line): line is string => line !== null);

  return lines.length > 0 ? `${title}:\n${lines.join("\n")}` : null;
}

function formatProperty(p: PropstackProperty): string {
  const title = fmt(p.title, "Untitled");
  const marketingType = fmt(p.marketing_type);
  const rsType = fmt(p.rs_type);
  const rsCategory = fmt(p.rs_category, "");

  const address = [fmt(p.street, ""), fmt(p.house_number, "")].filter(Boolean).join(" ");
  const cityLine = [fmt(p.zip_code, ""), fmt(p.city, "")].filter(Boolean).join(" ");
  const fullAddress = [address, cityLine, fmt(p.country, "")].filter(Boolean).join(", ");

  const lines: (string | null)[] = [
    `**${title}** (ID: ${p.id})`,
    `Type: ${marketingType} / ${rsType}${rsCategory ? ` / ${rsCategory}` : ""}`,
    `Address: ${fullAddress || "none"}`,
    marketingType === "BUY" || p.price ? `Price: ${fmtPrice(p.price)}` : null,
    marketingType === "RENT" || p.base_rent ? `Base rent: ${fmtPrice(p.base_rent)}` : null,
    p.total_rent ? `Total rent: ${fmtPrice(p.total_rent)}` : null,
    `Living space: ${fmtArea(p.living_space)}`,
    p.plot_area ? `Plot area: ${fmtArea(p.plot_area)}` : null,
    `Rooms: ${fmt(p.number_of_rooms)}`,
    p.number_of_bed_rooms ? `Bedrooms: ${fmt(p.number_of_bed_rooms)}` : null,
    p.number_of_bath_rooms ? `Bathrooms: ${fmt(p.number_of_bath_rooms)}` : null,
    p.floor !== undefined && p.floor !== null ? `Floor: ${fmt(p.floor)}` : null,
    p.construction_year ? `Built: ${fmt(p.construction_year)}` : null,
    `Status: ${fmt(p.property_status?.name)}`,
    `Broker: ${fmt(p.broker?.name, "unassigned")}`,
    p.project ? `Project: ${fmt(p.project.name)}` : null,
    p.exposee_id ? `Exposé ID: ${p.exposee_id}` : null,
  ];

  const details = [
    formatSection("Energy certificate", [
      ["Availability", p.energy_certificate_availability],
      ["Rating type", p.building_energy_rating_type],
      ["Efficiency class", p.energy_efficiency_class],
      ["Thermal characteristic", p.thermal_characteristic],
      ["Electricity portion", p.thermal_characteristic_electricity],
      ["Heating portion", p.thermal_characteristic_heating],
      ["Warm water included", p.energy_consumption_contains_warm_water, fmtYesNo],
      ["Certificate start", p.energy_certificate_start_date],
      ["Certificate end", p.energy_certificate_end_date],
      ["Heating type", p.heating_type],
      ["Firing types", p.firing_types, fmtList],
    ]),
    formatSection("Equipment", [
      ["Lift", p.lift, fmtYesNo],
      ["Cellar", p.cellar, fmtYesNo],
      ["Barrier free", p.barrier_free, fmtYesNo],
      ["Guest toilet", p.guest_toilet, fmtYesNo],
      ["Built-in kitchen", p.built_in_kitchen, fmtYesNo],
      ["Balcony", p.balcony, fmtYesNo],
      ["Garden", p.garden, fmtYesNo],
      ["Terrace", p.terrace, fmtYesNo],
      ["Monument", p.monument, fmtYesNo],
    ]),
    formatSection("Layout and condition", [
      ["Floors", p.number_of_floors],
      ["Balconies", p.number_of_balconies],
      ["Terraces", p.number_of_terraces],
      ["Parking spaces", p.number_of_parking_spaces],
      ["Floor label", p.floor_label],
      ["Parking space type", p.parking_space_type],
      ["Last refurbishment", p.last_refurbishment],
      ["Condition", p.condition],
      ["Interior quality", p.interior_quality],
      ["Technical modernization year", p.equipment_technology_construction_year],
    ]),
    formatSection("Marketing and costs", [
      ["Service charge", p.service_charge, fmtPrice],
      ["Heating costs", p.heating_costs, fmtPrice],
      ["Parking space price", p.parking_space_price, fmtPrice],
      ["Deposit", p.deposit],
      ["Sold price", p.sold_price, fmtPrice],
      ["Sold date", p.sold_date],
      ["Usable floor space", p.usable_floor_space, fmtArea],
      ["Total floor space", p.total_floor_space, fmtArea],
      ["Balcony space", p.balcony_space, fmtArea],
      ["Free from", p.free_from],
      ["Rented", p.rented, fmtYesNo],
    ]),
  ].filter(Boolean);

  return [...lines.filter(Boolean), ...details].join("\n");
}

function formatPropertyRow(p: PropstackProperty): string {
  const addr = [fmt(p.street, ""), fmt(p.house_number, "")].filter(Boolean).join(" ");
  const city = [fmt(p.zip_code, ""), fmt(p.city, "")].filter(Boolean).join(" ");
  const location = [addr, city].filter(Boolean).join(", ") || "—";
  const price = fmtPrice(p.price) !== "none"
    ? fmtPrice(p.price)
    : fmtPrice(p.base_rent) !== "none"
      ? fmtPrice(p.base_rent) + "/mo"
      : "—";
  const size = fmtArea(p.living_space) !== "none" ? fmtArea(p.living_space) : "—";
  const rooms = fmt(p.number_of_rooms) !== "none" ? `${fmt(p.number_of_rooms)}R` : "—";
  const status = fmt(p.property_status?.name, "—");
  const type = [fmt(p.marketing_type, ""), fmt(p.rs_type, "")].filter(Boolean).join("/");

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

const GERMAN_RESIDENTIAL_PROPERTY_FIELDS = {
  // Energy certificate
  energy_certificate_availability: z.string().optional()
    .describe("Energy certificate availability/exemption status"),
  building_energy_rating_type: z.string().optional()
    .describe("Energy rating type, e.g. Bedarfsausweis or Verbrauchsausweis"),
  energy_efficiency_class: z.string().optional()
    .describe("Energy efficiency class, e.g. A+, A, B, C, D, E, F, G, H"),
  thermal_characteristic: z.number().optional()
    .describe("Final energy demand/consumption in kWh/(m²·a)"),
  thermal_characteristic_electricity: z.number().optional()
    .describe("Electricity portion of the energy characteristic"),
  thermal_characteristic_heating: z.number().optional()
    .describe("Heating portion of the energy characteristic"),
  energy_consumption_contains_warm_water: z.boolean().optional()
    .describe("Whether energy consumption includes domestic hot water"),
  energy_certificate_start_date: z.string().optional()
    .describe("Energy certificate issue/start date"),
  energy_certificate_end_date: z.string().optional()
    .describe("Energy certificate expiry/end date"),
  heating_type: z.string().optional()
    .describe("Heating system type"),
  firing_types: z.union([z.string(), z.array(z.string())]).optional()
    .describe("Energy carrier/firing type or types"),

  // Standard residential equipment
  lift: z.boolean().optional().describe("Elevator available"),
  cellar: z.boolean().optional().describe("Basement/cellar available"),
  barrier_free: z.boolean().optional().describe("Barrier-free / accessible"),
  guest_toilet: z.boolean().optional().describe("Guest toilet available"),
  built_in_kitchen: z.boolean().optional().describe("Built-in kitchen available"),
  balcony: z.boolean().optional().describe("Balcony available"),
  garden: z.boolean().optional().describe("Garden available"),
  terrace: z.boolean().optional().describe("Terrace available"),
  monument: z.boolean().optional().describe("Listed-building / monument status"),

  // Layout and condition
  number_of_floors: z.number().optional().describe("Total number of floors in the building"),
  number_of_balconies: z.number().optional().describe("Number of balconies"),
  number_of_terraces: z.number().optional().describe("Number of terraces"),
  number_of_parking_spaces: z.number().optional().describe("Number of parking spaces"),
  floor_label: z.string().optional().describe("Floor label, e.g. '5. OG'"),
  parking_space_type: z.string().optional().describe("Parking space type, e.g. garage, carport, outdoor"),
  last_refurbishment: z.number().optional().describe("Year of last refurbishment"),
  condition: z.string().optional().describe("Property condition"),
  interior_quality: z.string().optional().describe("Interior quality"),
  equipment_technology_construction_year: z.number().optional()
    .describe("Year of last technical modernization"),

  // Costs, areas, availability, and long-form marketing text
  service_charge: z.number().optional().describe("Monthly service charge / Hausgeld"),
  heating_costs: z.number().optional().describe("Heating cost component"),
  parking_space_price: z.number().optional().describe("Parking space price"),
  deposit: z.union([z.string(), z.number()]).optional().describe("Security deposit"),
  sold_price: z.number().optional().describe("Realized sale price"),
  sold_date: z.string().optional().describe("Sale date"),
  usable_floor_space: z.number().optional().describe("Usable floor space (m²)"),
  total_floor_space: z.number().optional().describe("Total floor space (m²)"),
  balcony_space: z.number().optional().describe("Balcony area (m²)"),
  free_from: z.string().optional().describe("Availability date or free-from text"),
  rented: z.boolean().optional().describe("Whether the property is currently rented"),
  long_description_note: z.string().optional().describe("Long portal-specific description"),
  long_location_note: z.string().optional().describe("Long portal-specific location text"),
  long_furnishing_note: z.string().optional().describe("Long portal-specific furnishing text"),
  long_other_note: z.string().optional().describe("Long portal-specific miscellaneous text"),
} as const;

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

        // Append description texts if present (unwrap nested {value} from new=1 API)
        const descriptions: string[] = [];
        const desc = fmt(property.description_note, "");
        if (desc) descriptions.push(`**Description:** ${desc}`);
        const loc = fmt(property.location_note, "");
        if (loc) descriptions.push(`**Location:** ${loc}`);
        const furn = fmt(property.furnishing_note, "");
        if (furn) descriptions.push(`**Furnishing:** ${furn}`);
        const other = fmt(property.other_note, "");
        if (other) descriptions.push(`**Other:** ${other}`);
        const longDesc = fmt(property.long_description_note, "");
        if (longDesc) descriptions.push(`**Long description:** ${longDesc}`);
        const longLoc = fmt(property.long_location_note, "");
        if (longLoc) descriptions.push(`**Long location:** ${longLoc}`);
        const longFurn = fmt(property.long_furnishing_note, "");
        if (longFurn) descriptions.push(`**Long furnishing:** ${longFurn}`);
        const longOther = fmt(property.long_other_note, "");
        if (longOther) descriptions.push(`**Long other:** ${longOther}`);
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
            .map(([k, v]) => ({ k, s: fmt(v, "") }))
            .filter(({ s }) => s && s !== "none")
            .map(({ k, s }) => `  - ${k}: ${s}`);
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
      ...GERMAN_RESIDENTIAL_PROPERTY_FIELDS,
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
      ...GERMAN_RESIDENTIAL_PROPERTY_FIELDS,
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
        const res = await client.get<{ data?: PropstackPropertyStatus[] } | PropstackPropertyStatus[]>("/property_statuses");
        const statuses = Array.isArray(res) ? res : (res?.data ?? []);

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
