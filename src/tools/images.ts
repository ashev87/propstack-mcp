import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PropstackClient } from "../propstack-client.js";
import type { PropstackImage, PropstackProperty } from "../types/propstack.js";
import { PropstackError } from "../propstack-client.js";
import { textResult, errorResult, fmt, stripUndefined } from "./helpers.js";

const toolError = (text: string) => ({ ...textResult(text), isError: true as const });

const NO_V2_CLIENT =
  "This operation needs the Propstack API V2, which is not configured on this server.";

/**
 * Error result for calls against the Propstack API V2 (beta). Same handling
 * as errorResult, except that key problems point at the V2 key: Propstack can
 * issue separate V1 and V2 keys, so a working V1 key may still be rejected.
 */
function v2ErrorResult(err: unknown) {
  if (err instanceof PropstackError && (err.status === 401 || err.status === 403)) {
    return toolError(
      "The Propstack API V2 rejected the API key. Deleting images and setting " +
      "position / is_floorplan use the V2 API (beta). Set PROPSTACK_API_KEY_V2 " +
      "to a V2 key (falls back to PROPSTACK_API_KEY) and check its permissions " +
      "at crm.propstack.de/app/admin/api_keys",
    );
  }
  return errorResult("Image", err);
}

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

/**
 * @param client   V1 client (list, upload, title / visibility updates)
 * @param v2Client V2 client. The public V1 API documents neither deleting an
 *                 image nor its `position` / `is_floorplan` fields; the V2
 *                 (beta) API does, so those operations go through V2.
 */
export function registerImageTools(
  server: McpServer,
  client: PropstackClient,
  v2Client?: PropstackClient,
): void {
  // ── list_property_images ────────────────────────────────────────

  server.tool(
    "list_property_images",
    `List all images and floor plans of a property, in portal order.

Returns each image's ID, title, position, floorplan/private flags and URL.
Use the IDs with update_image and delete_image. Image URLs are signed and may expire after
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
    `Update an image's title, portal visibility, position or floor-plan flag.

Use list_property_images to find image IDs. Titles can be set per language
with title_de / title_en. Only provide the fields you want to change.

position sets the image's place in the property's image order (as shown by
list_property_images). is_floorplan marks the image as a floor plan
(Grundriss) or turns it back into a regular image.

position and is_floorplan are only available through the Propstack API V2
(beta). When either is given, the whole update is sent to V2, which may need
its own key (PROPSTACK_API_KEY_V2, falls back to PROPSTACK_API_KEY).`,
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
      position: z.number().int().optional()
        .describe("Position in the image order (API V2)"),
      is_floorplan: z.boolean().optional()
        .describe("true = mark as floor plan (Grundriss), false = regular image (API V2)"),
    },
    async (args) => {
      const { id, ...fields } = args;
      const image = stripUndefined(fields);
      if (Object.keys(image).length === 0) {
        return toolError("Nothing to update: provide at least one field.");
      }
      const summary = `Image ${id} updated (${Object.keys(image).join(", ")}).`;

      // position / is_floorplan exist only in the V2 API. V2 also accepts the
      // title and visibility fields, so send everything in one call there
      // instead of splitting the update across two APIs.
      if (image.position !== undefined || image.is_floorplan !== undefined) {
        if (!v2Client) return toolError(NO_V2_CLIENT);
        try {
          // V2 takes the fields at the top level (no `image` wrapper).
          await v2Client.put(`/images/${id}`, { body: image });
          return textResult(summary);
        } catch (err) {
          return v2ErrorResult(err);
        }
      }

      try {
        await client.put(`/images/${id}`, { body: { image } });
        return textResult(summary);
      } catch (err) {
        return errorResult("Image", err);
      }
    },
  );

  // ── delete_image ────────────────────────────────────────────────

  server.tool(
    "delete_image",
    `DESTRUCTIVE: permanently delete an image or floor plan from Propstack.

This cannot be undone. The image file is removed from the property or
project and from the portal export; there is no trash and no restore. To
only hide an image from portals, use update_image with is_private: true
instead.

Before calling, confirm the exact image with the user (use
list_property_images to show its ID and title). Deletes one image per call.

Uses the Propstack API V2 (beta), which may need its own key
(PROPSTACK_API_KEY_V2, falls back to PROPSTACK_API_KEY).`,
    {
      id: z.number()
        .describe("ID of the image to delete permanently"),
    },
    async (args) => {
      if (!v2Client) return toolError(NO_V2_CLIENT);
      try {
        await v2Client.delete(`/images/${args.id}`);
        return textResult(`Image ${args.id} permanently deleted.`);
      } catch (err) {
        return v2ErrorResult(err);
      }
    },
  );
}
