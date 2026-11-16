import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PropstackError, type PropstackClient } from "../src/propstack-client.js";
import { registerImageTools } from "../src/tools/images.js";
import { registerEmailTools } from "../src/tools/emails.js";

type RegisteredTool = {
  description: string;
  schema: Record<string, z.ZodType>;
  handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
};

function harness(register: (s: McpServer) => void) {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    tool(name: string, description: string, schema: Record<string, z.ZodType>, handler: RegisteredTool["handler"]) {
      tools.set(name, { description, schema, handler });
    },
  } as unknown as McpServer;
  register(server);
  const call = (name: string, args: Record<string, unknown>) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`tool ${name} not registered`);
    return tool.handler(z.object(tool.schema).parse(args));
  };
  return { tools, call };
}

const asClient = (c: Record<string, unknown>) => c as unknown as PropstackClient;

function imageHarness(v1: Record<string, unknown>, v2?: Record<string, unknown>) {
  return harness((s) => registerImageTools(s, asClient(v1), v2 ? asClient(v2) : undefined));
}

const emailHarness = (c: Record<string, unknown>) =>
  harness((s) => registerEmailTools(s, asClient(c)));

describe("delete_image", () => {
  it("deletes through the V2 API and never touches V1", async () => {
    const v1Delete = vi.fn();
    const v2Delete = vi.fn().mockResolvedValue(undefined);
    const { call } = imageHarness({ delete: v1Delete }, { delete: v2Delete });
    const res = await call("delete_image", { id: 38202 });
    expect(v2Delete).toHaveBeenCalledWith("/images/38202");
    expect(v1Delete).not.toHaveBeenCalled();
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("38202");
  });

  it("is described as destructive and irreversible", () => {
    const { tools } = imageHarness({}, {});
    const description = tools.get("delete_image")!.description;
    expect(description).toMatch(/^DESTRUCTIVE/);
    expect(description).toContain("cannot be undone");
  });

  it("returns API failures as MCP tool errors", async () => {
    const notFound = vi.fn().mockRejectedValue(new PropstackError(404, "Not Found", "", "/images/5"));
    const res = await imageHarness({}, { delete: notFound }).call("delete_image", { id: 5 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Image not found");
  });

  it("fails cleanly when no V2 client is configured", async () => {
    const res = await imageHarness({}).call("delete_image", { id: 5 });
    expect(res.isError).toBe(true);
  });
});

describe("update_image position / floor plan", () => {
  it("sends position and is_floorplan to V2 as a flat body, with the other fields", async () => {
    const v1Put = vi.fn();
    const v2Put = vi.fn().mockResolvedValue({});
    const { call } = imageHarness({ put: v1Put }, { put: v2Put });
    const res = await call("update_image", { id: 9, position: 2, is_floorplan: true, title: "Grundriss EG" });
    expect(v2Put).toHaveBeenCalledWith("/images/9", {
      body: { title: "Grundriss EG", position: 2, is_floorplan: true },
    });
    expect(v1Put).not.toHaveBeenCalled();
    expect(res.isError).toBeUndefined();
  });

  it("can unset the floor-plan flag (false is sent, not dropped)", async () => {
    const v2Put = vi.fn().mockResolvedValue({});
    await imageHarness({}, { put: v2Put }).call("update_image", { id: 9, is_floorplan: false });
    expect(v2Put).toHaveBeenCalledWith("/images/9", { body: { is_floorplan: false } });
  });

  it("keeps title / visibility updates on V1", async () => {
    const v1Put = vi.fn().mockResolvedValue({});
    const v2Put = vi.fn();
    await imageHarness({ put: v1Put }, { put: v2Put }).call("update_image", { id: 9, is_private: true });
    expect(v1Put).toHaveBeenCalledWith("/images/9", { body: { image: { is_private: true } } });
    expect(v2Put).not.toHaveBeenCalled();
  });

  it("returns V2 failures as MCP tool errors", async () => {
    const v2Put = vi.fn().mockRejectedValue(new PropstackError(422, "Unprocessable", '{"error":"bad position"}', "/images/9"));
    const res = await imageHarness({}, { put: v2Put }).call("update_image", { id: 9, position: -1 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("bad position");
  });
});

const feed = (data: Record<string, unknown>[], total = data.length) => ({ data, meta: { total_count: total } });

describe("list_inbound_emails", () => {
  it("queries the activity feed for messages with the documented filters", async () => {
    const get = vi.fn().mockResolvedValue(feed([]));
    await emailHarness({ get }).call("list_inbound_emails", { client_id: 7, property_id: 3, per: 50 });
    expect(get).toHaveBeenCalledWith("/activities", {
      params: { client_id: 7, property_id: 3, per: 50, item_type: "message", order: "desc" },
    });
  });

  it("keeps only received emails and leaves out names, addresses and bodies", async () => {
    const get = vi.fn().mockResolvedValue(feed([
      { id: 1, title: "Anfrage Wohnung", outgoing: false, client_ids: [7], property_ids: [3],
        client_names: ["Stefanie Mante"], body: "Hallo, ich interessiere mich", created_at: "2026-11-01T10:00:00+01:00" },
      { id: 2, title: "Ihr Exposé", outgoing: true, client_ids: [7] },
    ], 2));
    const res = await emailHarness({ get }).call("list_inbound_emails", { client_id: 7 });
    const text = res.content[0].text;
    expect(text).toContain("1 inbound emails");
    expect(text).toContain("Anfrage Wohnung");
    expect(text).toContain("activity ID: 1");
    expect(text).toContain("Contact IDs: 7");
    expect(text).not.toContain("Ihr Exposé");
    expect(text).not.toContain("Stefanie Mante");
    expect(text).not.toContain("interessiere");
  });

  it("says so when a page holds only sent emails and more pages exist", async () => {
    const get = vi.fn().mockResolvedValue(feed([{ id: 2, title: "Ihr Exposé", outgoing: true }], 45));
    const text = (await emailHarness({ get }).call("list_inbound_emails", {})).content[0].text;
    expect(text).toContain("No inbound emails on this page");
    expect(text).toContain("request page 2");
  });

  it("errors instead of guessing when the direction flag is missing", async () => {
    const get = vi.fn().mockResolvedValue(feed([{ id: 2, title: "Hallo" }]));
    const res = await emailHarness({ get }).call("list_inbound_emails", {});
    expect(res.isError).toBe(true);
  });

  it("returns API failures as MCP tool errors", async () => {
    const get = vi.fn().mockRejectedValue(new PropstackError(429, "Too Many Requests", "", "/activities"));
    const res = await emailHarness({ get }).call("list_inbound_emails", {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Rate limited");
  });
});

describe("get_email", () => {
  const message = {
    id: 48192929,
    subject: "Anfrage Wohnung",
    body: "<p>Hallo,</p><p>ich interessiere mich &amp; bitte um R&uuml;ckruf.<br>Gru&szlig;</p><style>p{color:red}</style>",
    from: ["kontakt@mail.com"],
    to: ["makler@firma.de"],
    cc: [],
    bcc: ["geheim@firma.de"],
    client_ids: [7],
    property_ids: [3],
    project_ids: [],
    message_attachment_ids: [11],
  };
  const activity = { id: 41711, activatable_type: "Message", activatable: message };

  it("reads the email through the activity and returns the body as text", async () => {
    const get = vi.fn().mockResolvedValue(activity);
    const res = await emailHarness({ get }).call("get_email", { activity_id: 41711 });
    expect(get).toHaveBeenCalledWith("/activities/41711");
    const text = res.content[0].text;
    expect(text).toContain("message ID: 48192929");
    expect(text).toContain("Subject: Anfrage Wohnung");
    expect(text).toContain("From: kontakt@mail.com");
    expect(text).toContain("ich interessiere mich & bitte");
    expect(text).not.toContain("<p>");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("geheim@firma.de");
  });

  it("returns only the requested fields", async () => {
    const get = vi.fn().mockResolvedValue(activity);
    const text = (await emailHarness({ get }).call("get_email", {
      activity_id: 41711, fields: ["subject", "client_ids"],
    })).content[0].text;
    expect(text).toContain("subject: Anfrage Wohnung");
    expect(text).toContain("client_ids: [7]");
    expect(text).not.toContain("kontakt@mail.com");
    expect(text).not.toContain("interessiere");
  });

  it("rejects unknown fields before calling the API", async () => {
    const get = vi.fn();
    const res = await emailHarness({ get }).call("get_email", { activity_id: 1, fields: ["password"] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Unknown email field");
    expect(get).not.toHaveBeenCalled();
  });

  it("truncates very long bodies", async () => {
    const get = vi.fn().mockResolvedValue({ ...activity, activatable: { ...message, body: "x".repeat(20000) } });
    const text = (await emailHarness({ get }).call("get_email", { activity_id: 41711 })).content[0].text;
    expect(text).toContain("truncated, 12000 more characters");
    expect(text.length).toBeLessThan(9000);
  });

  it("errors when the activity is not an email", async () => {
    const get = vi.fn().mockResolvedValue({ id: 5, activatable_type: "Task", activatable: { title: "Anruf" } });
    const res = await emailHarness({ get }).call("get_email", { activity_id: 5 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("not an email");
  });

  it("returns API failures as MCP tool errors", async () => {
    const get = vi.fn().mockRejectedValue(new PropstackError(404, "Not Found", "", "/activities/5"));
    const res = await emailHarness({ get }).call("get_email", { activity_id: 5 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("not found");
  });
});
