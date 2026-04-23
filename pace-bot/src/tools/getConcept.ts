import { eq, ilike } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { concepts } from "../db/schema.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z
  .object({
    slug: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
  })
  .refine((v) => v.slug || v.name, {
    message: "Provide slug or name",
  });

export const getConceptTool: ToolDefinition = {
  definition: {
    name: "get_concept",
    description:
      "Get the full explanation for a concept by slug (preferred) or name.",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        name: { type: "string" },
      },
    },
  },
  handler: async (raw) => {
    const input = inputSchema.parse(raw);

    if (input.slug) {
      const [row] = await db
        .select()
        .from(concepts)
        .where(eq(concepts.slug, input.slug))
        .limit(1);
      if (row) return JSON.stringify(row);
    }

    if (input.name) {
      const [row] = await db
        .select()
        .from(concepts)
        .where(ilike(concepts.name, `%${input.name}%`))
        .limit(1);
      if (row) return JSON.stringify(row);
    }

    return JSON.stringify({ error: "Concept not found" });
  },
};
