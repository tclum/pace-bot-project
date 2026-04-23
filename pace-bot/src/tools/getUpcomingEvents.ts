import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { events, programs } from "../db/schema.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  within_days: z.number().int().min(1).max(180).default(30),
  program_slug: z.string().min(1).optional(),
});

export const getUpcomingEventsTool: ToolDefinition = {
  definition: {
    name: "get_upcoming_events",
    description: "List upcoming public PACE events.",
    input_schema: {
      type: "object",
      properties: {
        within_days: {
          type: "integer",
          default: 30,
          minimum: 1,
          maximum: 180,
        },
        program_slug: { type: "string" },
      },
    },
  },
  handler: async (raw) => {
    const input = inputSchema.parse(raw);
    const now = new Date();
    const until = new Date(now.getTime() + input.within_days * 86_400_000);

    const conditions = [
      eq(events.isPublic, true),
      gte(events.startsAt, now),
      lte(events.startsAt, until),
    ];

    if (input.program_slug) {
      conditions.push(
        sql`${events.programId} = (SELECT id FROM ${programs} WHERE ${programs.slug} = ${input.program_slug})`,
      );
    }

    const rows = await db
      .select({
        name: events.name,
        description: events.description,
        starts_at: events.startsAt,
        ends_at: events.endsAt,
        location: events.location,
        program_slug: programs.slug,
      })
      .from(events)
      .leftJoin(programs, eq(events.programId, programs.id))
      .where(and(...conditions))
      .orderBy(asc(events.startsAt));

    return JSON.stringify(rows);
  },
};
