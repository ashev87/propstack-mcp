import { describe, it, expect } from "vitest";
import {
  validateFields,
  renderFieldValue,
  renderProjectedRecord,
  applyCustomFilters,
  unwrapPropstackValue,
  unwrapNumber,
  fmt,
  fmtPrice,
  fmtArea,
  stripUndefined,
  CONTACT_FIELDS,
} from "../src/tools/helpers.js";

describe("validateFields", () => {
  it("returns null when every requested field is known", () => {
    expect(validateFields(["first_name", "email"], CONTACT_FIELDS, "contact")).toBeNull();
  });

  it("returns null for an empty request", () => {
    expect(validateFields([], CONTACT_FIELDS, "contact")).toBeNull();
  });

  it("names the unknown field and uses singular wording for one bad name", () => {
    const msg = validateFields(["email", "bogus"], CONTACT_FIELDS, "contact");
    expect(msg).toContain("bogus");
    expect(msg).toContain("Unknown contact field:");
    // Valid options are listed so the caller can correct the name.
    expect(msg).toContain("first_name");
  });

  it("uses plural wording and lists every unknown field", () => {
    const msg = validateFields(["nope1", "nope2"], CONTACT_FIELDS, "contact");
    expect(msg).toContain("Unknown contact fields:");
    expect(msg).toContain("nope1");
    expect(msg).toContain("nope2");
  });
});

describe("renderFieldValue", () => {
  it("renders empty-ish values as 'none'", () => {
    expect(renderFieldValue(null)).toBe("none");
    expect(renderFieldValue(undefined)).toBe("none");
    expect(renderFieldValue("")).toBe("none");
  });

  it("renders primitives, including falsy 0 and false", () => {
    expect(renderFieldValue("Maria")).toBe("Maria");
    expect(renderFieldValue(0)).toBe("0");
    expect(renderFieldValue(false)).toBe("false");
  });

  it("unwraps Propstack scalar wrappers", () => {
    expect(renderFieldValue({ value: 42 })).toBe("42");
    expect(renderFieldValue({ value: 1234, pretty_value: "1.234 €" })).toBe("1.234 €");
  });

  it("extracts a readable name from name/label objects", () => {
    expect(renderFieldValue({ id: 5, name: "Berlin" })).toBe("Berlin");
  });

  it("renders genuine nested objects and arrays as JSON so nothing is lost", () => {
    expect(renderFieldValue({ a: 1 })).toBe('{"a":1}');
    expect(renderFieldValue([1, 2, 3])).toBe("[1,2,3]");
  });
});

describe("renderProjectedRecord", () => {
  it("emits the header followed by only the requested fields", () => {
    const record = { id: 7, first_name: "Maria", last_name: "Schmidt", email: "m@x.de" };
    const out = renderProjectedRecord(record, ["first_name", "email"], "**ID: 7**");
    expect(out).toBe("**ID: 7**\nfirst_name: Maria\nemail: m@x.de");
  });

  it("renders a missing field as 'none'", () => {
    const out = renderProjectedRecord({ id: 7 }, ["email"], "**ID: 7**");
    expect(out).toBe("**ID: 7**\nemail: none");
  });
});

describe("applyCustomFilters", () => {
  it("returns the params unchanged when no custom filters are given", () => {
    const params = { q: "Berlin" };
    expect(applyCustomFilters(params, undefined)).toBe(params);
  });

  it("prefixes plain field names with cf_ and merges them in", () => {
    const out = applyCustomFilters({ q: "Berlin" }, { marketing_channel: "Website" });
    expect(out).toEqual({ q: "Berlin", cf_marketing_channel: "Website" });
  });

  it("does not double-prefix names that already start with cf_", () => {
    const out = applyCustomFilters({}, { cf_energy_class: "A" });
    expect(out).toEqual({ cf_energy_class: "A" });
  });

  it("preserves string, number and boolean values and does not mutate the input", () => {
    const params = { q: "x" };
    const out = applyCustomFilters(params, { a: "s", b: 3, c: true });
    expect(out).toEqual({ q: "x", cf_a: "s", cf_b: 3, cf_c: true });
    expect(params).toEqual({ q: "x" });
  });
});

describe("unwrapPropstackValue", () => {
  it("returns primitives untouched", () => {
    expect(unwrapPropstackValue("x")).toBe("x");
    expect(unwrapPropstackValue(5)).toBe(5);
    expect(unwrapPropstackValue(null)).toBeNull();
  });

  it("prefers pretty_value, then value, then name/label", () => {
    expect(unwrapPropstackValue({ value: 10, pretty_value: "ten" })).toBe("ten");
    expect(unwrapPropstackValue({ value: 10 })).toBe(10);
    expect(unwrapPropstackValue({ label: "Reserviert" })).toBe("Reserviert");
    expect(unwrapPropstackValue({ name: "Verfügbar" })).toBe("Verfügbar");
  });
});

describe("unwrapNumber", () => {
  it("coerces numbers, numeric strings and wrappers", () => {
    expect(unwrapNumber(42)).toBe(42);
    expect(unwrapNumber("42")).toBe(42);
    expect(unwrapNumber({ value: "1234" })).toBe(1234);
  });

  it("returns null for non-numeric input", () => {
    expect(unwrapNumber("abc")).toBeNull();
    expect(unwrapNumber(null)).toBeNull();
  });
});

describe("fmt", () => {
  it("falls back for null/empty and objects, but renders scalars", () => {
    expect(fmt(null)).toBe("none");
    expect(fmt(null, "—")).toBe("—");
    expect(fmt({ deeply: { nested: true } }, "fallback")).toBe("fallback");
    expect(fmt({ value: 5 })).toBe("5");
  });
});

describe("fmtPrice / fmtArea", () => {
  it("formats prices in EUR and areas with a unit", () => {
    expect(fmtPrice(null)).toBe("none");
    expect(fmtPrice(1000)).toContain("1.000");
    expect(fmtPrice(1000)).toContain("€");
    expect(fmtArea(null)).toBe("none");
    expect(fmtArea(50)).toBe("50 m²");
  });
});

describe("stripUndefined", () => {
  it("drops undefined keys but keeps null, false, 0 and empty string", () => {
    const out = stripUndefined({ a: undefined, b: null, c: false, d: 0, e: "" });
    expect(out).toEqual({ b: null, c: false, d: 0, e: "" });
    expect("a" in out).toBe(false);
  });
});
