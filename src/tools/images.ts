import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type { PropstackImage, PropstackProperty } from "../types/propstack.js";
import { textResult, errorResult, fmt, stripUndefined } from "./helpers.js";

// ── Response formatting ──────────────────────────────────────────────

function formatImage(img: PropstackImage): string {
  const flags: string[] = [];
  if (img.is_floorplan) flags.push("floorplan");
  if (img.is_private) flags.push("private (not on portals)");
  const pos = img.position !== null && img.position !== undefined ? `#${img.position} ` : "";
  return `- ${pos}**${fmt(img.title, "Untitled")}** (ID: ${img.id})` +
    (flags.length ? ` — ${flags.join(", ")}` : "") +
    (img.url ? `\n  ${img.url}` : "");
}

// ── Tool registration ────────────────────────────────────────────────

export function registerImageTools(server: McpServer, client: PropstackClient): void {
  // ── list_property_images ────────────────────────────────────────

  server.tool(
    "list_property_images",
    `List all images and floor plans of a property, in portal order.

Returns each image's ID, title, position, floorplan/private flags and URL.
Use the IDs with update_image. Image URLs are signed and may expire after
a while; fetch them again rather than storing them.`,
    {
      property_id: z.number()
        .describe("Property ID"),
    },
    async (args) => {
      try {
        const property = await client.get<PropstackProperty>(
          `/units/${args.property_id}`,
          { params: { new: 1 } },
        );

        const images = [...(property.images ?? [])];
        const floorplans = [...(property.floorplans ?? [])];
        const byPosition = (a: PropstackImage, b: PropstackImage) =>
          (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER);
        images.sort(byPosition);
        floorplans.sort(byPosition);

        if (images.length === 0 && floorplans.length === 0) {
          return textResult(`Property ${args.property_id} has no images or floor plans.`);
        }

        const sections: string[] = [
          `# Images for ${fmt(property.title, "Untitled")} (ID: ${property.id})`,
        ];
        if (images.length) {
          sections.push(`## Images (${images.length})\n${images.map(formatImage).join("\n")}`);
        }
        if (floorplans.length) {
          sections.push(`## Floor plans (${floorplans.length})\n${floorplans.map(formatImage).join("\n")}`);
        }
        return textResult(sections.join("\n\n"));
      } catch (err) {
        return errorResult("Property", err);
      }
    },
  );

  // ── upload_image ────────────────────────────────────────────────

  server.tool(
    "upload_image",
    `Upload an image to a property or project in Propstack.

The photo must be a base64 data URI, e.g. "data:image/jpeg;base64,/9j/4AAQ...".
Attach to exactly one of property_id or project_id.

is_private: false (default) = the image is published to portals;
true = kept internal. The title is shown as caption and used in the file name.

For AI-staged or edited images (virtual staging), say so in the title,
e.g. "Wohnzimmer (virtuell möbliert)"; German law requires the label.`,
    {
      photo: z.string()
        .describe("Image as base64 data URI (e.g. 'data:image/jpeg;base64,...')"),
      property_id: z.number().optional()
        .describe("Attach to this property"),
      project_id: z.number().optional()
        .describe("Attach to this project"),
      title: z.string().optional()
        .describe("Caption / title of the image"),
      is_private: z.boolean().optional()
        .describe("true = hide from portals (default false)"),
    },
    async (args) => {
      try {
        const targets = [args.property_id, args.project_id].filter((v) => v !== undefined);
        if (targets.length !== 1) {
          return { ...textResult("Provide exactly one of property_id or project_id."), isError: true as const };
        }
        if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(args.photo)) {
          return {
            ...textResult("photo must be a base64 data URI starting with 'data:image/<type>;base64,'."),
            isError: true as const,
          };
        }

        const image = stripUndefined({
          imageable_id: args.property_id ?? args.project_id,
          imageable_type: args.property_id !== undefined ? "Property" : "Project",
          photo: args.photo,
          title: args.title,
          is_private: args.is_private,
        });

        const res = await client.post<{ ok?: boolean; id?: number }>(
          "/images",
          { body: { image } },
        );

        const owner = args.property_id !== undefined
          ? `property ${args.property_id}`
          : `project ${args.project_id}`;
        return textResult(`Image uploaded to ${owner} (image ID: ${fmt(res.id)}).`);
      } catch (err) {
        return errorResult("Image", err);
      }
    },
  );

  // ── update_image ────────────────────────────────────────────────

  server.tool(
    "update_image",
    `Update an image's title or portal visibility.

Use list_property_images to find image IDs. Titles can be set per language
with title_de / title_en. Only provide the fields you want to change.`,
    {
      id: z.number()
        .describe("Image ID"),
      title: z.string().optional()
        .describe("New title (default language)"),
      title_de: z.string().optional()
        .describe("German title"),
      title_en: z.string().optional()
        .describe("English title"),
      is_private: z.boolean().optional()
        .describe("true = hide from portals, false = publish to portals"),
    },
    async (args) => {
      try {
        const { id, ...fields } = args;
        const image = stripUndefined(fields);
        if (Object.keys(image).length === 0) {
          return { ...textResult("Nothing to update: provide at least one field."), isError: true as const };
        }
        await client.put(`/images/${id}`, { body: { image } });
        return textResult(`Image ${id} updated (${Object.keys(image).join(", ")}).`);
      } catch (err) {
        return errorResult("Image", err);
      }
    },
  );
}
