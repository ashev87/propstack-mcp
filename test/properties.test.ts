import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../src/propstack-client.js";
import { registerPropertyTools } from "../src/tools/properties.js";

type RegisteredTool = {
  schema: Record<string, z.ZodType>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

function propertyHarness() {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    tool(
      name: string,
      _description: string,
      schema: Record<string, z.ZodType>,
      handler: RegisteredTool["handler"],
    ) {
      tools.set(name, { schema, handler });
    },
  } as unknown as McpServer;

  const post = vi.fn(async () => ({ id: 1, title: "Test" }));
  const put = vi.fn(async () => ({ id: 1, title: "Test" }));
  const client = { post, put } as unknown as PropstackClient;

  registerPropertyTools(server, client);
  return { tools, post, put };
}

const energyFields = {
  energy_certificate_availability: "AVAILABLE",
  building_energy_rating_type: "DEMAND",
  energy_efficiency_class: "E",
  thermal_characteristic: 160,
  thermal_characteristic_electricity: 40,
  thermal_characteristic_heating: 120,
  energy_consumption_contains_warm_water: false,
  energy_certificate_start_date: "2026-01-15",
  energy_certificate_end_date: "2036-01-14",
  heating_type: "GAS_HEATING",
  firing_types: "GAS",
};

describe("property energy-certificate write coverage", () => {
  it("accepts and forwards all 11 energy fields when creating a property", async () => {
    const { tools, post } = propertyHarness();
    const tool = tools.get("create_property");
    expect(tool).toBeDefined();

    const args = z.object(tool!.schema).parse({ title: "GEG-ready listing", ...energyFields });
    await tool!.handler(args);

    expect(post).toHaveBeenCalledWith("/units", {
      body: { property: { title: "GEG-ready listing", ...energyFields } },
    });
  });

  it("accepts and forwards all 11 energy fields when updating a property", async () => {
    const { tools, put } = propertyHarness();
    const tool = tools.get("update_property");
    expect(tool).toBeDefined();

    const args = z.object(tool!.schema).parse({ id: 42, ...energyFields });
    await tool!.handler(args);

    expect(put).toHaveBeenCalledWith("/units/42", {
      body: { property: energyFields },
    });
  });
});
