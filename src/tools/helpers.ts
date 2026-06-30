import { PropstackError } from "../propstack-client.js";

export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/**
 * Parse 422 validation error body into human-readable field errors.
 */
function parse422(detail: string): string {
  try {
    const parsed = JSON.parse(detail);
    // Propstack returns { errors: { field: ["msg", ...] } } or { error: "msg" }
    if (parsed.errors && typeof parsed.errors === "object") {
      const lines: string[] = [];
      for (const [field, msgs] of Object.entries(parsed.errors)) {
        const msgList = Array.isArray(msgs) ? msgs.join(", ") : String(msgs);
        lines.push(`  ${field}: ${msgList}`);
      }
      if (lines.length > 0) return `Validation failed:\n${lines.join("\n")}`;
    }
    if (parsed.error) return `Validation error: ${parsed.error}`;
  } catch {
    // Not JSON, return as-is
  }
  return `Validation error: ${detail}`;
}

/**
 * Extract a resource ID from the API path for better 404 messages.
 * e.g. "/contacts/123" → "123", "/units/456" → "456"
 */
function extractIdFromPath(path: string): string | null {
  const match = /\/(\d+)(?:\/|$)/.exec(path);
  return match?.[1] ?? null;
}

/**
 * Format any error into a user-friendly string.
 */
export function formatError(err: unknown): string {
  if (err instanceof PropstackError) {
    const id = extractIdFromPath(err.path);
    switch (err.status) {
      case 401:
        return "Invalid API key. Check your PROPSTACK_API_KEY. Manage keys at crm.propstack.de/app/admin/api_keys";
      case 403:
        return "Insufficient permissions. Check API key permissions in Propstack admin.";
      case 404:
        return id
          ? `Not found. The resource with ID ${id} does not exist (${err.path}).`
          : `Not found (${err.path}).`;
      case 422:
        return parse422(err.detail);
      case 429:
        return "Rate limited by Propstack API. Please try again in a moment.";
      default:
        return `Propstack API error ${err.status}: ${err.detail}`;
    }
  }
  if (err instanceof Error && err.name === "TimeoutError") {
    return "Request to Propstack API timed out after multiple attempts. Please try again in a moment.";
  }
  if (err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("ECONNREFUSED") || err.message.includes("ENOTFOUND"))) {
    return `Network error: could not reach Propstack API. Check your internet connection. (${err.message})`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export function errorResult(entity: string, err: unknown) {
  if (err instanceof PropstackError) {
    const id = extractIdFromPath(err.path);
    if (err.status === 401) {
      return textResult("Invalid API key. Check your PROPSTACK_API_KEY. Manage keys at crm.propstack.de/app/admin/api_keys");
    }
    if (err.status === 403) {
      return textResult("Insufficient permissions. Check API key permissions in Propstack admin.");
    }
    if (err.status === 404) {
      return id
        ? textResult(`${entity} not found. No ${entity.toLowerCase()} with ID ${id} exists.`)
        : textResult(`${entity} not found.`);
    }
    if (err.status === 422) {
      return textResult(parse422(err.detail));
    }
    if (err.status === 429) {
      return textResult("Rate limited by Propstack API. Please try again in a moment.");
    }
    return textResult(`Propstack API error ${err.status}: ${err.detail}`);
  }
  const msg = formatError(err);
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

/**
 * Propstack API with new=1/expand=1 returns nested objects like { value: X } or
 * { value: X, pretty_value: Y }. Unwrap to the underlying primitive for display.
 */
export function unwrapPropstackValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === "object" && val !== null) {
    const o = val as Record<string, unknown>;
    if ("pretty_value" in o && o.pretty_value != null && o.pretty_value !== "") {
      return unwrapPropstackValue(o.pretty_value);
    }
    if ("value" in o) {
      return unwrapPropstackValue(o.value);
    }
    // Handle {label: "..."} pattern (project status, etc.)
    if ("label" in o && typeof o.label === "string") {
      return o.label;
    }
    // Handle {name: "..."} pattern (contact status, property status, etc.)
    if ("name" in o && typeof o.name === "string") {
      return o.name;
    }
  }
  return val;
}

export function fmt(value: unknown, fallback = "none"): string {
  const v = unwrapPropstackValue(value);
  if (v === null || v === undefined || v === "") return fallback;
  if (typeof v === "object") return fallback;
  return String(v);
}

/** Unwrap and coerce to number for price/area formatting. */
export function unwrapNumber(val: unknown): number | null {
  const v = unwrapPropstackValue(val);
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

export function fmtPrice(value: unknown): string {
  const n = unwrapNumber(value);
  if (n === null) return "none";
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

export function fmtArea(value: unknown, unit = "m²"): string {
  const n = unwrapNumber(value);
  if (n === null) return "none";
  return `${n} ${unit}`;
}

export function fmtNested(obj: unknown, key: string, fallback = "none"): string {
  if (!obj || typeof obj !== "object") return fallback;
  const val = (obj as Record<string, unknown>)[key];
  return fmt(val, fallback);
}

/**
 * Remove keys with undefined values from an object so we don't send
 * nulls to the API when optional fields are omitted.
 */
export function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as Partial<T>;
}

// ── Field selection (data minimization, Art. 25 DSGVO) ────────────────
//
// Bulk-data tools accept an optional `fields` whitelist so a controller can
// request only the fields they need. These arrays are the known, selectable
// field names per entity type — they mirror the interfaces in
// types/propstack.ts and are used to validate the `fields` parameter so
// unknown names fail loudly instead of being silently dropped.

export const CONTACT_FIELDS = [
  "id", "name", "first_name", "last_name", "salutation", "email", "phone",
  "home_cell", "home_phone", "office_phone", "fax", "company", "position",
  "description", "home_street", "home_house_number", "home_zip_code",
  "home_city", "home_country", "office_street", "office_house_number",
  "office_zip_code", "office_city", "office_country", "broker_id", "broker",
  "client_source_id", "client_source", "client_status_id", "client_status",
  "status", "language", "rating", "newsletter", "accept_contact",
  "gdpr_status", "warning_notice", "groups", "custom_fields",
  "last_contact_at", "last_contact_at_formatted", "created_at", "updated_at",
  "archived", "children", "documents", "relationships", "owned_properties",
  "old_crm_id",
] as const;

export const PROPERTY_FIELDS = [
  "id", "title", "unit_id", "exposee_id", "marketing_type", "object_type",
  "rs_type", "rs_category", "street", "house_number", "zip_code", "city",
  "country", "lat", "lng", "price", "base_rent", "total_rent", "living_space",
  "plot_area", "property_space_value", "number_of_rooms",
  "number_of_bed_rooms", "number_of_bath_rooms", "floor", "construction_year",
  "description_note", "location_note", "furnishing_note", "other_note",
  "courtage", "courtage_note", "broker_id", "broker", "project_id", "project",
  "status", "property_status", "property_groups", "custom_fields", "images",
  "floorplans", "documents", "links", "created_at", "updated_at", "archived",
] as const;

export const DEAL_FIELDS = [
  "id", "broker_id", "client_id", "property_id", "project_id", "deal_stage_id",
  "deal_pipeline_id", "sold_price", "note", "date", "start_date",
  "reservation_reason_id", "feeling", "category", "client", "property",
  "deal_stage", "deal_pipeline", "created_at", "updated_at",
] as const;

/**
 * Validate a requested `fields` list against a known field set. Returns a
 * clear, user-facing error message if any field is unknown, or null if all
 * requested fields are valid. Unknown fields are reported by name alongside
 * the full list of valid options — never silently ignored.
 */
export function validateFields(
  requested: readonly string[],
  known: readonly string[],
  entityLabel: string,
): string | null {
  const knownSet = new Set(known);
  const unknown = requested.filter((f) => !knownSet.has(f));
  if (unknown.length === 0) return null;
  const plural = unknown.length === 1 ? "field" : "fields";
  return (
    `Unknown ${entityLabel} ${plural}: ${unknown.join(", ")}. ` +
    `Valid ${entityLabel} fields are: ${known.join(", ")}.`
  );
}

/**
 * Render a single (possibly nested) field value for projected output.
 * Unwraps Propstack scalar wrappers and name/label objects where possible
 * for readability; renders genuine nested objects/arrays as JSON so no data
 * is lost.
 */
export function renderFieldValue(value: unknown): string {
  if (value !== null && typeof value === "object") {
    const unwrapped = unwrapPropstackValue(value);
    if (typeof unwrapped !== "object" || unwrapped === null) {
      return unwrapped === null || unwrapped === undefined || unwrapped === ""
        ? "none"
        : String(unwrapped);
    }
    return JSON.stringify(value);
  }
  return value === null || value === undefined || value === "" ? "none" : String(value);
}

/**
 * Project a record to only the requested fields and render it as a markdown
 * block. `header` identifies the record (e.g. its ID). Used by bulk tools
 * when a `fields` whitelist is supplied.
 */
export function renderProjectedRecord(
  record: Record<string, unknown>,
  fields: readonly string[],
  header: string,
): string {
  const lines = [header, ...fields.map((f) => `${f}: ${renderFieldValue(record[f])}`)];
  return lines.join("\n");
}

type QueryParams = Record<string, string | number | boolean | string[] | number[] | undefined>;

/**
 * Expand a custom-field filter map into `cf_<name>` query parameters and
 * merge it into the given params. Field names are taken as-is (the cf_
 * prefix is added if missing), so the caller passes plain custom field
 * names from list_custom_fields. Returns a new object; params is not mutated.
 */
export function applyCustomFilters(
  params: QueryParams,
  customFilters: Record<string, string | number | boolean> | undefined,
): QueryParams {
  if (!customFilters) return params;
  const out: QueryParams = { ...params };
  for (const [key, value] of Object.entries(customFilters)) {
    const cfKey = key.startsWith("cf_") ? key : `cf_${key}`;
    out[cfKey] = value;
  }
  return out;
}
