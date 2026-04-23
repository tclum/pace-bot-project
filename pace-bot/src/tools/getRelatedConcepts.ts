import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { concepts } from "../db/schema.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  slug: z.string().min(1),
});

export const getRelatedConceptsTool: ToolDefinition = {
  definition: {
    name: "get_related_concepts",
    description:
      "Given a concept slug, return the concepts it links to. Useful for 'tell me more' or 'what else is connected to this?'",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string" },
      },
      required: ["slug"],
    },
  },
  handler: async (raw) => {
    const input = inputSchema.parse(raw);

    const [source] = await db
      .select({ relatedConceptSlugs: concepts.relatedConceptSlugs })
      .from(concepts)
      .where(eq(concepts.slug, input.slug))
      .limit(1);

    if (!source) {
      return JSON.stringify({ error: "Concept not found" });
    }

    const related = source.relatedConceptSlugs ?? [];
    if (related.length === 0) return JSON.stringify([]);

    const rows = await db
      .select({
        slug: concepts.slug,
        name: concepts.name,
        short_definition: concepts.shortDefinition,
      })
      .from(concepts)
      .where(inArray(concepts.slug, related));

    return JSON.stringify(rows);
  },
};
