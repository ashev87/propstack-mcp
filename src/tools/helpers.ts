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

export function fmt(value: unknown, fallback = "none"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
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
