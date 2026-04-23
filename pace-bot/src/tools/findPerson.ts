import { and, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { people } from "../db/schema.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z
  .object({
    name: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
  })
  .refine((v) => v.name || v.role, {
    message: "Provide name or role",
  });

export const findPersonTool: ToolDefinition = {
  definition: {
    name: "find_person",
    description:
      "Look up a PACE staff member, leader, or mentor by name or role.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        role: { type: "string" },
      },
    },
  },
  handler: async (raw) => {
    const input = inputSchema.parse(raw);

    const filters = [eq(people.isCurrent, true)];
    const matchers = [];
    if (input.name) matchers.push(ilike(people.name, `%${input.name}%`));
    if (input.role) matchers.push(ilike(people.role, `%${input.role}%`));
    if (matchers.length) {
      const combined = matchers.length === 1 ? matchers[0] : or(...matchers);
      if (combined) filters.push(combined);
    }

    const rows = await db
      .select({
        name: people.name,
        role: people.role,
        bio: people.bio,
        program_slugs: people.programSlugs,
      })
      .from(people)
      .where(and(...filters))
      .limit(5);

    return JSON.stringify(rows);
  },
};
