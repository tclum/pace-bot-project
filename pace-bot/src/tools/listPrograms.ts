import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { programs } from "../db/schema.js";
import type { ToolDefinition } from "./types.js";

const PROGRAM_CATEGORIES = [
  "accelerator",
  "competition",
  "leadership",
  "workshop",
  "grant",
  "other",
] as const;

const inputSchema = z.object({
  category: z.enum(PROGRAM_CATEGORIES).optional(),
  active_only: z.boolean().default(true),
});

export const listProgramsTool: ToolDefinition = {
  definition: {
    name: "list_programs",
    description:
      "List PACE programs, optionally filtered by category. Use when the user asks what programs exist, or wants an overview by type (accelerators, competitions, etc.).",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: [...PROGRAM_CATEGORIES] },
        active_only: { type: "boolean", default: true },
      },
    },
  },
  handler: async (raw) => {
    const input = inputSchema.parse(raw);

    const conditions = [];
    if (input.active_only) conditions.push(eq(programs.isActive, true));
    if (input.category) conditions.push(eq(programs.category, input.category));

    const rows = await db
      .select({
        slug: programs.slug,
        name: programs.name,
        category: programs.category,
        short_description: programs.shortDescription,
        next_deadline: programs.nextDeadline,
      })
      .from(programs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(programs.name));

    return JSON.stringify(rows);
  },
};
