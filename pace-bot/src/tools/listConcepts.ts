import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { concepts } from "../db/schema.js";
import type { ToolDefinition } from "./types.js";

const CONCEPT_CATEGORIES = [
  "mindset",
  "framework",
  "cultural",
  "practice",
] as const;

const inputSchema = z.object({
  category: z.enum(CONCEPT_CATEGORIES).optional(),
});

export const listConceptsTool: ToolDefinition = {
  definition: {
    name: "list_concepts",
    description:
      "List entrepreneurship concepts from PACE's curriculum. Use when the user asks what's in the curriculum or wants a category overview.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: [...CONCEPT_CATEGORIES] },
      },
    },
  },
  handler: async (raw) => {
    const input = inputSchema.parse(raw);

    const query = db
      .select({
        slug: concepts.slug,
        name: concepts.name,
        category: concepts.category,
        short_definition: concepts.shortDefinition,
      })
      .from(concepts)
      .orderBy(asc(concepts.name));

    const rows = input.category
      ? await query.where(eq(concepts.category, input.category))
      : await query;

    return JSON.stringify(rows);
  },
};
