import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../src/propstack-client.js";
import type { PropstackProperty, PropstackSearchProfile } from "../src/types/propstack.js";
import { registerCompositeTools, scoreProfileAgainstProperty } from "../src/tools/composites.js";
import { registerImageTools } from "../src/tools/images.js";

type RegisteredTool = {
  schema: Record<string, z.ZodType>;
  handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
};

function harness(register: (s: McpServer, c: PropstackClient) => void, client: Partial<PropstackClient>) {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    tool(name: string, _d: string, schema: Record<string, z.ZodType>, handler: RegisteredTool["handler"]) {
      tools.set(name, { schema, handler });
    },
  } as unknown as McpServer;
  register(server, client as PropstackClient);
  const call = (name: string, args: Record<string, unknown>) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`tool ${name} not registered`);
    return tool.handler(z.object(tool.schema).parse(args));
  };
  return { tools, call };
}

const profile = (over: Partial<PropstackSearchProfile> = {}): PropstackSearchProfile => ({
  id: 7,
  client_id: 99,
  active: true,
  marketing_type: "BUY",
  cities: ["Berlin"],
  rs_types: ["APARTMENT"],
  price: 300000,
  price_to: 400000,
  base_rent: null,
  base_rent_to: null,
  number_of_rooms: 3,
  number_of_rooms_to: 3,
  living_space: null,
  living_space_to: null,
  balcony: "true",
  ...over,
} as unknown as PropstackSearchProfile);

const property = (over: Partial<PropstackProperty> = {}): PropstackProperty => ({
  id: 1,
  title: "3-Zi. Charlottenburg",
  marketing_type: "BUY",
  rs_type: "APARTMENT",
  city: "Berlin",
  price: 385000,
  base_rent: null,
  number_of_rooms: 3,
  living_space: 82,
  balcony: true,
  ...over,
} as unknown as PropstackProperty);

describe("scoreProfileAgainstProperty", () => {
  it("scores a perfect fit at 100% including features", () => {
    const r = scoreProfileAgainstProperty(profile(), property());
    expect(r.score).toBe(r.maxScore);
    expect(r.matches).toContain("Balcony: yes");
    expect(r.mismatches).toHaveLength(0);
  });

  it("reports feature and price mismatches", () => {
    const r = scoreProfileAgainstProperty(profile(), property({ balcony: false, price: 450000 } as Partial<PropstackProperty>));
    expect(r.score).toBeLessThan(r.maxScore);
    expect(r.mismatches.some((m) => m.startsWith("Balcony"))).toBe(true);
    expect(r.mismatches.some((m) => m.startsWith("Price"))).toBe(true);
  });

  it("ignores criteria the profile leaves empty", () => {
    const broad = profile({ price: null, price_to: null, number_of_rooms: null, number_of_rooms_to: null, rs_types: [], balcony: "" } as Partial<PropstackSearchProfile>);
    const r = scoreProfileAgainstProperty(broad, property());
    expect(r.maxScore).toBe(6); // marketing type (3) + city (3)
  });
});

describe("match_properties_to_contact", () => {
  it("pre-filters via the API and ranks the best fit first", async () => {
    const get = vi.fn(async (path: string) => {
      if (path === "/saved_queries") return { data: [profile()] };
      if (path === "/units") {
        return {
          data: [
            property({ id: 2, title: "Too expensive", price: 520000 } as Partial<PropstackProperty>),
            property({ id: 1 }),
          ],
          meta: { total_count: 2 },
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    const { call } = harness(registerCompositeTools, { get } as unknown as Partial<PropstackClient>);
    const res = await call("match_properties_to_contact", { contact_id: 99, status: "5980" });

    const unitsCall = get.mock.calls.find(([p]) => p === "/units") as unknown as [string, { params: Record<string, unknown> }];
    expect(unitsCall[1].params).toMatchObject({
      marketing_type: "BUY", price_from: 300000, price_to: 400000,
      number_of_rooms_from: 3, rs_type: "APARTMENT", status: "5980",
    });
    const text = res.content[0].text;
    expect(text.indexOf("(ID: 1)")).toBeLessThan(text.indexOf("(ID: 2)"));
  });

  it("explains when the contact has no active search profile", async () => {
    const get = vi.fn(async () => ({ data: [profile({ active: false })] }));
    const { call } = harness(registerCompositeTools, { get } as unknown as Partial<PropstackClient>);
    const res = await call("match_properties_to_contact", { contact_id: 99 });
    expect(res.content[0].text).toContain("no active search profiles");
  });
});

describe("image tools", () => {
  it("uploads a base64 image to a property", async () => {
    const post = vi.fn(async () => ({ ok: true, id: 38202 }));
    const { call } = harness(registerImageTools, { post } as unknown as Partial<PropstackClient>);
    const res = await call("upload_image", {
      photo: "data:image/jpeg;base64,AAAA", property_id: 12, title: "Ausblick",
    });
    expect(post).toHaveBeenCalledWith("/images", {
      body: { image: { imageable_id: 12, imageable_type: "Property", photo: "data:image/jpeg;base64,AAAA", title: "Ausblick" } },
    });
    expect(res.content[0].text).toContain("38202");
  });

  it("rejects uploads without exactly one target or with a non-image payload", async () => {
    const post = vi.fn();
    const { call } = harness(registerImageTools, { post } as unknown as Partial<PropstackClient>);
    expect((await call("upload_image", { photo: "data:image/png;base64,AA" })).isError).toBe(true);
    expect((await call("upload_image", { photo: "https://x/y.png", property_id: 1 })).isError).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });

  it("lists images and floor plans in portal order", async () => {
    const get = vi.fn(async () => ({
      id: 5, title: "Villa",
      images: [
        { id: 2, title: "Garten", position: 2, is_floorplan: false, is_private: false, url: null },
        { id: 1, title: "Front", position: 1, is_floorplan: false, is_private: true, url: null },
      ],
      floorplans: [{ id: 3, title: "EG", position: 1, is_floorplan: true, is_private: false, url: null }],
    }));
    const { call } = harness(registerImageTools, { get } as unknown as Partial<PropstackClient>);
    const text = (await call("list_property_images", { property_id: 5 })).content[0].text;
    expect(text.indexOf("Front")).toBeLessThan(text.indexOf("Garten"));
    expect(text).toContain("Floor plans (1)");
    expect(text).toContain("private (not on portals)");
  });

  it("updates only the fields provided", async () => {
    const put = vi.fn(async () => ({}));
    const { call } = harness(registerImageTools, { put } as unknown as Partial<PropstackClient>);
    await call("update_image", { id: 9, title_de: "Ausblick", is_private: false });
    expect(put).toHaveBeenCalledWith("/images/9", { body: { image: { title_de: "Ausblick", is_private: false } } });
    expect((await call("update_image", { id: 9 })).isError).toBe(true);
  });
});
