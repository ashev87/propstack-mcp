import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../src/propstack-client.js";
import { registerImageTools } from "../src/tools/images.js";
import { registerPortalTools } from "../src/tools/portals.js";
import { registerLinkTools } from "../src/tools/links.js";
import { registerDocumentTools } from "../src/tools/documents.js";
import { registerRelationshipTools } from "../src/tools/relationships.js";
import { registerProjectTools } from "../src/tools/projects.js";
import { registerTaskTools } from "../src/tools/tasks.js";
import { registerPropertyTools } from "../src/tools/properties.js";
import { formatActivityDetail, namedIds, registerActivityTools } from "../src/tools/activities.js";
import { htmlToText } from "../src/tools/helpers.js";

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
type Client = Partial<Record<"get" | "post" | "put" | "delete", ReturnType<typeof vi.fn>>>;

function harness(
  register: (s: McpServer, c: PropstackClient, v2: PropstackClient) => void,
  client: Client,
  v2: Client = {},
) {
  const tools = new Map<string, { schema: Record<string, z.ZodType>; handler: Handler }>();
  const server = {
    tool(name: string, _d: string, schema: Record<string, z.ZodType>, handler: Handler) {
      tools.set(name, { schema, handler });
    },
  } as unknown as McpServer;
  register(server, client as unknown as PropstackClient, v2 as unknown as PropstackClient);
  return (name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`tool ${name} not registered`);
    return tool.handler(z.object(tool.schema).parse(args));
  };
}

const ok = () => vi.fn(async () => ({}));

describe("image tools (V2 endpoints)", () => {
  it("routes V1-only fields to V1 and floorplan/position to V2 with a flat body", async () => {
    const v1 = { put: ok() };
    const v2 = { put: ok() };
    const call = harness(registerImageTools, v1, v2);
    await call("update_image", { id: 9, title: "Front" });
    expect(v1.put).toHaveBeenCalledWith("/images/9", { body: { image: { title: "Front" } } });
    await call("update_image", { id: 9, is_floorplan: true, title: "EG" });
    expect(v2.put).toHaveBeenCalledWith("/images/9", { body: { is_floorplan: true, title: "EG" } });
  });

  it("sorts images on exactly one owner", async () => {
    const v2 = { put: ok() };
    const call = harness(registerImageTools, {}, v2);
    const res = await call("sort_images", { image_ids: [3, 1, 2], property_id: 5 });
    expect(v2.put).toHaveBeenCalledWith("/images/sort", { body: { item: [3, 1, 2], property_id: 5 } });
    expect(res.content[0].text).toContain("title image: 3");
    expect((await call("sort_images", { image_ids: [1] })).isError).toBe(true);
  });

  it("deletes an image via V2", async () => {
    const v2 = { delete: ok() };
    await harness(registerImageTools, {}, v2)("delete_image", { id: 4 });
    expect(v2.delete).toHaveBeenCalledWith("/images/4");
  });
});

describe("portal tools", () => {
  it("lists portals from V2 and publishes via V1", async () => {
    const v2 = { get: vi.fn(async () => ({ data: [{ id: 1, name: "ImmoScout", format: ["IS24", 1] }] })) };
    const v1 = { post: ok() };
    const call = harness(registerPortalTools, v1, v2);
    const list = (await call("list_portals")).content[0].text;
    expect(list).toContain("| 1 | ImmoScout | IS24 |");
    const res = await call("publish_to_portals", { property_ids: [7], portal_ids: [1], active: false });
    expect(v1.post).toHaveBeenCalledWith("/portals/publish", {
      body: { property_ids: [7], portal_ids: [1], active: false },
    });
    expect(res.content[0].text).toContain("Removal from 1 portal(s)");
  });
});

describe("link tools", () => {
  it("creates a link with property_id at the top level", async () => {
    const post = vi.fn(async () => ({ id: 2, title: "360°", url: "https://t.example", is_private: true }));
    const res = await harness(registerLinkTools, { post })("create_property_link", {
      property_id: 5, title: "360°", url: "https://t.example", is_private: true,
    });
    expect(post).toHaveBeenCalledWith("/links", {
      body: { property_id: 5, link: { title: "360°", url: "https://t.example", is_private: true } },
    });
    expect(res.content[0].text).toContain("private (not on portals)");
  });

  it("refuses an empty update", async () => {
    const put = ok();
    expect((await harness(registerLinkTools, { put })("update_property_link", { id: 1 })).isError).toBe(true);
    expect(put).not.toHaveBeenCalled();
  });
});

describe("document tools", () => {
  it("updates, deletes and lists tags", async () => {
    const client = {
      put: vi.fn(async () => ({ id: 3, title: "EA.pdf", tags: ["Energieausweis"] })),
      delete: ok(),
      get: vi.fn(async () => ({ data: ["Energieausweis"], meta: { total_count: 1 } })),
    };
    const call = harness(registerDocumentTools, client);
    await call("update_document", { id: 3, tags: ["Energieausweis"] });
    expect(client.put).toHaveBeenCalledWith("/documents/3", { body: { document: { tags: ["Energieausweis"] } } });
    await call("delete_document", { id: 3 });
    expect(client.delete).toHaveBeenCalledWith("/documents/3");
    expect((await call("list_document_tags")).content[0].text).toContain("- Energieausweis");
  });
});

describe("relationship tools", () => {
  it("sends client_id and property_id in the DELETE body", async () => {
    const del = ok();
    const call = harness(registerRelationshipTools, { delete: del });
    await call("delete_ownership", { client_id: 1, property_id: 2 });
    await call("delete_partnership", { client_id: 1, property_id: 2 });
    expect(del).toHaveBeenNthCalledWith(1, "/ownerships", { body: { client_id: 1, property_id: 2 } });
    expect(del).toHaveBeenNthCalledWith(2, "/partnerships", { body: { client_id: 1, property_id: 2 } });
  });

  it("toggles a favorite with property_id as query parameter", async () => {
    const post = ok();
    await harness(registerRelationshipTools, { post })("toggle_contact_favorite", { client_id: 4, property_id: 8 });
    expect(post).toHaveBeenCalledWith("/contacts/4/favorites", { params: { property_id: 8 } });
  });
});

describe("project, task and property tools", () => {
  it("creates and updates a project inside a project wrapper", async () => {
    const client = { post: vi.fn(async () => ({ ok: true, id: 24 })), put: ok() };
    const call = harness(registerProjectTools, client);
    const res = await call("create_project", { name: "Living Home", status: "SALES" });
    expect(client.post).toHaveBeenCalledWith("/projects", { body: { project: { name: "Living Home", status: "SALES" } } });
    expect(res.content[0].text).toContain("ID: 24");
    await call("update_project", { id: 24, city: "Berlin" });
    expect(client.put).toHaveBeenCalledWith("/projects/24", { body: { project: { city: "Berlin" } } });
  });

  it("deletes tasks and properties", async () => {
    const del = ok();
    await harness(registerTaskTools, { delete: del })("delete_task", { id: 11 });
    await harness(registerPropertyTools, { delete: del })("delete_property", { id: 12 });
    expect(del).toHaveBeenCalledWith("/tasks/11");
    expect(del).toHaveBeenCalledWith("/units/12");
  });
});

describe("activities", () => {
  it("maps the type filter to item_type and the date range to original_created_at_*", async () => {
    const get = vi.fn(async () => ({
      data: [{
        id: 1, title: "Anfrage Whg 3", conversation_type: "message", outgoing: false,
        client_ids: [5], client_names: ["Stefanie Mante"], property_ids: [9], property_names: ["CLA-1050"],
        created_at: "2026-11-10",
      }],
      meta: { total_count: 1 },
    }));
    const text = (await harness(registerActivityTools, { get })("search_activities", {
      type: "message", only_inquiries: true, created_from: "2026-11-01",
    })).content[0].text;
    expect(get).toHaveBeenCalledWith("/activities", {
      params: { item_type: "message", only_inquiries: true, original_created_at_from: "2026-11-01" },
    });
    expect(text).toContain("Type: message (incoming)");
    expect(text).toContain("Contacts: Stefanie Mante (ID: 5)");
    expect(text).toContain("Properties: CLA-1050 (ID: 9)");
  });

  it("renders an email activity with plain-text body", () => {
    const text = formatActivityDetail({
      id: 41711,
      activatable_type: "Message",
      activatable: {
        id: 77, subject: "Besichtigung", from: ["a@example.com"], to: ["makler@example.com"],
        body: "<p>Hallo,</p><p>ich h&auml;tte gern einen Termin &amp; mehr Infos.<br>Gruß</p>",
        client_ids: [5], read: false, created_at: "2026-11-12",
      },
    });
    expect(text).toContain("**Besichtigung** (email ID: 77)");
    expect(text).toContain("From: a@example.com");
    expect(text).toContain("Read: no");
    expect(text).toContain("Contact IDs: 5");
    expect(text).toContain("ich hätte gern einen Termin & mehr Infos.\nGruß");
  });

  it("truncates very long bodies", () => {
    const text = formatActivityDetail({
      id: 1, activatable_type: "Task", activatable: { id: 2, title: "Notiz", body: "x".repeat(9000) },
    });
    expect(text).toContain("[… truncated, 1000 more characters]");
  });

  it("pairs ids with names", () => {
    expect(namedIds([1, 2], ["A"])).toBe("A (ID: 1), ID 2");
  });
});

describe("htmlToText", () => {
  it("keeps structure and drops markup", () => {
    expect(htmlToText("<style>p{}</style><ul><li>Eins</li><li>Zwei</li></ul><!-- x --><p>A&nbsp;&lt;B&gt; &#8364;</p>"))
      .toBe("- Eins\n- Zwei\nA <B> €");
    expect(htmlToText("Gr&uuml;&szlig;e &amp;nbsp;")).toBe("Grüße &nbsp;");
    expect(htmlToText(null)).toBe("");
  });
});
