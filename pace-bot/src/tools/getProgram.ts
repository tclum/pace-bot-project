import { eq, ilike } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { programs } from "../db/schema.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z
  .object({
    slug: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
  })
  .refine((v) => v.slug || v.name, {
    message: "Provide slug or name",
  });

export const getProgramTool: ToolDefinition = {
  definition: {
    name: "get_program",
    description:
      "Get full details for one PACE program. Prefer slug when you know it; use name for fuzzy lookup.",
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
        .from(programs)
        .where(eq(programs.slug, input.slug))
        .limit(1);
      if (row) return JSON.stringify(row);
    }

    if (input.name) {
      const [row] = await db
        .select()
        .from(programs)
        .where(ilike(programs.name, `%${input.name}%`))
        .limit(1);
      if (row) return JSON.stringify(row);
    }

    return JSON.stringify({ error: "Program not found" });
  },
};
