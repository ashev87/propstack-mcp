import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type { PropstackSearchProfile, PropstackPaginatedResponse } from "../types/propstack.js";
import { textResult, errorResult, fmt, stripUndefined } from "./helpers.js";

// ── Response formatting ──────────────────────────────────────────────

function fmtRange(from: number | null | undefined, to: number | null | undefined, unit = ""): string | null {
  if (from === null && to === null) return null;
  if (from === undefined && to === undefined) return null;
  if (from !== null && from !== undefined && to !== null && to !== undefined) {
    return `${from}–${to}${unit ? ` ${unit}` : ""}`;
  }
  if (from !== null && from !== undefined) return `≥ ${from}${unit ? ` ${unit}` : ""}`;
  return `≤ ${to}${unit ? ` ${unit}` : ""}`;
}

function fmtPriceRange(from: number | null | undefined, to: number | null | undefined): string | null {
  const format = (v: number) => v.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  if ((from === null || from === undefined) && (to === null || to === undefined)) return null;
  if (from !== null && from !== undefined && to !== null && to !== undefined) return `${format(from)} – ${format(to)}`;
  if (from !== null && from !== undefined) return `≥ ${format(from)}`;
  return `≤ ${format(to!)}`;
}

function fmtFeature(value: boolean | null | undefined): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "any";
}

function formatSearchProfile(sp: PropstackSearchProfile): string {
  const lines: (string | null)[] = [
    `**Search Profile #${sp.id}** (Contact: ${fmt(sp.client_id)})`,
    `Active: ${sp.active ? "yes" : "no"}`,
    `Type: ${fmt(sp.marketing_type, "any")}`,
  ];

  // Location
  if (sp.cities?.length) lines.push(`Cities: ${sp.cities.join(", ")}`);
  if (sp.regions?.length) lines.push(`Regions: ${sp.regions.join(", ")}`);
  if (sp.lat !== null && sp.lat !== undefined && sp.lng !== null && sp.lng !== undefined) {
    lines.push(`Center: ${sp.lat}, ${sp.lng} (radius: ${sp.radius ?? "?"}m)`);
  }

  // Property types
  if (sp.rs_types?.length) lines.push(`Types: ${sp.rs_types.join(", ")}`);
  if (sp.rs_categories?.length) lines.push(`Categories: ${sp.rs_categories.join(", ")}`);

  // Price ranges
  const price = fmtPriceRange(sp.price, sp.price_to);
  if (price) lines.push(`Price: ${price}`);
  const rent = fmtPriceRange(sp.base_rent, sp.base_rent_to);
  if (rent) lines.push(`Base rent: ${rent}`);
  const totalRent = fmtPriceRange(sp.total_rent, sp.total_rent_to);
  if (totalRent) lines.push(`Total rent: ${totalRent}`);

  // Space ranges
  const living = fmtRange(sp.living_space, sp.living_space_to, "m²");
  if (living) lines.push(`Living space: ${living}`);
  const plot = fmtRange(sp.plot_area, sp.plot_area_to, "m²");
  if (plot) lines.push(`Plot area: ${plot}`);

  // Room ranges
  const rooms = fmtRange(sp.number_of_rooms, sp.number_of_rooms_to);
  if (rooms) lines.push(`Rooms: ${rooms}`);
  const bedrooms = fmtRange(sp.number_of_bed_rooms, sp.number_of_bed_rooms_to);
  if (bedrooms) lines.push(`Bedrooms: ${bedrooms}`);

  // Other ranges
  const floor = fmtRange(sp.floor, sp.floor_to);
  if (floor) lines.push(`Floor: ${floor}`);
  const year = fmtRange(sp.construction_year, sp.construction_year_to);
  if (year) lines.push(`Built: ${year}`);

  // Features — only show if set
  const features: string[] = [];
  if (sp.lift !== null && sp.lift !== undefined) features.push(`Lift: ${fmtFeature(sp.lift)}`);
  if (sp.balcony !== null && sp.balcony !== undefined) features.push(`Balcony: ${fmtFeature(sp.balcony)}`);
  if (sp.garden !== null && sp.garden !== undefined) features.push(`Garden: ${fmtFeature(sp.garden)}`);
  if (sp.built_in_kitchen !== null && sp.built_in_kitchen !== undefined) features.push(`Kitchen: ${fmtFeature(sp.built_in_kitchen)}`);
  if (sp.cellar !== null && sp.cellar !== undefined) features.push(`Cellar: ${fmtFeature(sp.cellar)}`);
  if (sp.rented !== null && sp.rented !== undefined) features.push(`Rented: ${fmtFeature(sp.rented)}`);
  if (features.length) lines.push(`Features: ${features.join(", ")}`);

  // Investment
  const ppsqm = fmtPriceRange(sp.price_per_sqm, sp.price_per_sqm_to);
  if (ppsqm) lines.push(`Price/m²: ${ppsqm}`);
  const mult = fmtRange(sp.price_multiplier, sp.price_multiplier_to, "x");
  if (mult) lines.push(`Multiplier: ${mult}`);
  const yld = fmtRange(sp.yield_actual, sp.yield_actual_to, "%");
  if (yld) lines.push(`Yield: ${yld}`);

  if (sp.note) lines.push(`Note: ${sp.note}`);
  lines.push(`Created: ${fmt(sp.created_at)}`);

  return lines.filter(Boolean).join("\n");
}

// ── Shared Zod params for create / update ────────────────────────────

function searchProfileFields() {
  return {
    active: z.boolean().optional()
      .describe("Whether the search profile is active (default: true)"),
    marketing_type: z.enum(["BUY", "RENT"]).optional()
      .describe("Marketing type: BUY (Kauf) or RENT (Miete)"),

    // Location
    cities: z.array(z.string()).optional()
      .describe("City names to search in (e.g. ['Berlin', 'Potsdam'])"),
    regions: z.array(z.string()).optional()
      .describe("Region names to search in"),
    lat: z.number().optional()
      .describe("Latitude for radius search center"),
    lng: z.number().optional()
      .describe("Longitude for radius search center"),
    radius: z.number().optional()
      .describe("Search radius in meters from lat/lng center"),
    location_ids: z.array(z.number()).optional()
      .describe("Propstack location/district IDs"),

    // Property types
    rs_types: z.array(z.string()).optional()
      .describe("Property types (e.g. ['APARTMENT', 'HOUSE'])"),
    rs_categories: z.array(z.string()).optional()
      .describe("Property categories (e.g. ['APARTMENT_NORMAL', 'HOUSE_DETACHED'])"),

    // Price ranges
    price: z.number().optional()
      .describe("Minimum purchase price (EUR)"),
    price_to: z.number().optional()
      .describe("Maximum purchase price (EUR)"),
    base_rent: z.number().optional()
      .describe("Minimum base rent (EUR/month)"),
    base_rent_to: z.number().optional()
      .describe("Maximum base rent (EUR/month)"),
    total_rent: z.number().optional()
      .describe("Minimum total rent (EUR/month)"),
    total_rent_to: z.number().optional()
      .describe("Maximum total rent (EUR/month)"),

    // Space ranges
    living_space: z.number().optional()
      .describe("Minimum living space (m²)"),
    living_space_to: z.number().optional()
      .describe("Maximum living space (m²)"),
    plot_area: z.number().optional()
      .describe("Minimum plot area (m²)"),
    plot_area_to: z.number().optional()
      .describe("Maximum plot area (m²)"),

    // Room ranges
    number_of_rooms: z.number().optional()
      .describe("Minimum number of rooms"),
    number_of_rooms_to: z.number().optional()
      .describe("Maximum number of rooms"),
    number_of_bed_rooms: z.number().optional()
      .describe("Minimum number of bedrooms"),
    number_of_bed_rooms_to: z.number().optional()
      .describe("Maximum number of bedrooms"),

    // Other ranges
    floor: z.number().optional()
      .describe("Minimum floor"),
    floor_to: z.number().optional()
      .describe("Maximum floor"),
    construction_year: z.number().optional()
      .describe("Minimum construction year"),
    construction_year_to: z.number().optional()
      .describe("Maximum construction year"),

    // Feature booleans — API accepts string "true"/"false" or empty
    lift: z.string().optional()
      .describe("Lift/elevator required: 'true', 'false', or omit for any"),
    balcony: z.string().optional()
      .describe("Balcony required: 'true', 'false', or omit for any"),
    garden: z.string().optional()
      .describe("Garden required: 'true', 'false', or omit for any"),
    built_in_kitchen: z.string().optional()
      .describe("Built-in kitchen required: 'true', 'false', or omit for any"),
    cellar: z.string().optional()
      .describe("Cellar required: 'true', 'false', or omit for any"),
    rented: z.string().optional()
      .describe("Currently rented: 'true', 'false', or omit for any"),

    // Investment criteria
    price_per_sqm: z.number().optional()
      .describe("Minimum price per m² (EUR)"),
    price_per_sqm_to: z.number().optional()
      .describe("Maximum price per m² (EUR)"),
    price_multiplier: z.number().optional()
      .describe("Minimum price multiplier (Vervielfältiger)"),
    price_multiplier_to: z.number().optional()
      .describe("Maximum price multiplier"),
    yield_actual: z.number().optional()
      .describe("Minimum actual yield (%)"),
    yield_actual_to: z.number().optional()
      .describe("Maximum actual yield (%)"),

    // Tags & notes
    group_ids: z.array(z.number()).optional()
      .describe("Tag/group IDs to assign"),
    note: z.string().optional()
      .describe("Free-text note about this search profile"),
  };
}

// ── Tool registration ────────────────────────────────────────────────

export function registerSearchProfileTools(server: McpServer, client: PropstackClient): void {
  // ── list_search_profiles ────────────────────────────────────────

  server.tool(
    "list_search_profiles",
    `List search profiles (Suchprofile) in Propstack.

A search profile captures what a buyer or renter is looking for — cities,
price range, room count, features, etc. Every search profile belongs to
a contact.

Use this tool to:
- See what a specific contact is looking for (filter by client)
- List all active search profiles
- Review criteria before matching properties

Filter by contact ID to answer "What is this buyer looking for?"`,
    {
      client: z.number().optional()
        .describe("Contact ID — show only this contact's search profiles"),
      page: z.number().optional()
        .describe("Page number (default: 1)"),
      per_page: z.number().optional()
        .describe("Results per page (default: 25)"),
    },
    async (args) => {
      try {
        const res = await client.get<PropstackPaginatedResponse<PropstackSearchProfile>>(
          "/saved_queries",
          { params: args as Record<string, string | number | boolean | undefined> },
        );

        if (!res.data || res.data.length === 0) {
          return textResult("No search profiles found.");
        }

        const header = res.meta?.total_count !== undefined
          ? `Found ${res.meta.total_count} search profiles (showing ${res.data.length}):\n\n`
          : `Found ${res.data.length} search profiles:\n\n`;

        const formatted = res.data.map(formatSearchProfile).join("\n\n---\n\n");
        return textResult(header + formatted);
      } catch (err) {
        return errorResult("Search profile", err);
      }
    },
  );

  // ── create_search_profile ───────────────────────────────────────

  server.tool(
    "create_search_profile",
    `Create a search profile (Suchprofil) for a contact in Propstack.

This is THE killer feature for an AI real estate assistant. When a buyer
or renter describes what they're looking for in natural language, map it
to structured search criteria:

Example conversation:
  "Herr Weber sucht eine 3-Zimmer-Wohnung in Berlin oder Potsdam,
   Budget 300.000–400.000 €, muss einen Balkon haben"
  →
  client_id: <Herr Weber's ID>
  marketing_type: "BUY"
  rs_types: ["APARTMENT"]
  cities: ["Berlin", "Potsdam"]
  number_of_rooms: 3, number_of_rooms_to: 3
  price: 300000, price_to: 400000
  balcony: "true"

Mapping guide:
- "Wohnung" / "apartment" → rs_types: ["APARTMENT"]
- "Haus" / "house" → rs_types: ["HOUSE"]
- "kaufen" / "buy" → marketing_type: "BUY"
- "mieten" / "rent" → marketing_type: "RENT"
- "3 Zimmer" → number_of_rooms: 3, number_of_rooms_to: 3
- "3-4 Zimmer" → number_of_rooms: 3, number_of_rooms_to: 4
- "bis 400k" → price_to: 400000
- "mind. 80m²" → living_space: 80
- "mit Balkon" → balcony: "true"
- "mit Aufzug" → lift: "true"
- "mit Garten" → garden: "true"
- "mit EBK" → built_in_kitchen: "true"
- "Neubau" → construction_year: 2020

Feature booleans use strings: "true" = required, "false" = excluded,
omit = don't care.

Use radius search (lat/lng/radius) for "within 5km of Alexanderplatz".`,
    {
      client_id: z.number()
        .describe("Contact ID this search profile belongs to (required)"),
      ...searchProfileFields(),
    },
    async (args) => {
      try {
        const profile = await client.post<PropstackSearchProfile>(
          "/saved_queries",
          { body: { saved_query: stripUndefined(args) } },
        );

        return textResult(`Search profile created successfully.\n\n${formatSearchProfile(profile)}`);
      } catch (err) {
        return errorResult("Search profile", err);
      }
    },
  );

  // ── update_search_profile ───────────────────────────────────────

  server.tool(
    "update_search_profile",
    `Update an existing search profile in Propstack.

Use this tool to:
- Expand or narrow budget ("increase max price to 450k")
- Add or change cities ("also look in Potsdam")
- Adjust room count or space requirements
- Toggle feature requirements (add/remove balcony, lift, etc.)
- Activate or deactivate the profile

Only provide the fields you want to change.`,
    {
      id: z.number()
        .describe("Search profile ID to update"),
      client_id: z.number().optional()
        .describe("Contact ID (rarely changed)"),
      ...searchProfileFields(),
    },
    async (args) => {
      try {
        const { id, ...fields } = args;
        const profile = await client.put<PropstackSearchProfile>(
          `/saved_queries/${id}`,
          { body: { saved_query: stripUndefined(fields) } },
        );

        return textResult(`Search profile updated successfully.\n\n${formatSearchProfile(profile)}`);
      } catch (err) {
        return errorResult("Search profile", err);
      }
    },
  );

  // ── delete_search_profile ───────────────────────────────────────

  server.tool(
    "delete_search_profile",
    `Delete a search profile from Propstack.

Use this tool when:
- A contact has found a property and is no longer searching
- The search profile was created in error
- A contact explicitly asks to stop receiving matching notifications`,
    {
      id: z.number()
        .describe("Search profile ID to delete"),
    },
    async (args) => {
      try {
        await client.delete(`/saved_queries/${args.id}`);
        return textResult(`Search profile ${args.id} deleted.`);
      } catch (err) {
        return errorResult("Search profile", err);
      }
    },
  );
}
