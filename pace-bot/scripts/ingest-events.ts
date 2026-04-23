import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, sqlClient } from "../src/db/client.js";
import { events, programs } from "../src/db/schema.js";

const eventSchema = z.object({
  program_slug: z.string().min(1).nullish(),
  name: z.string().min(1),
  description: z.string().nullish(),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }).nullish(),
  location: z.string().nullish(),
  registration_url: z.string().url().nullish(),
  is_public: z.boolean().default(true),
});

const fileSchema = z.array(eventSchema);

async function main() {
  const filePath =
    process.argv[2] ??
    fileURLToPath(new URL("../data/events.json", import.meta.url));
  const raw = await readFile(resolve(filePath), "utf8");
  const parsed = fileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error("Validation failed:", parsed.error.issues);
    process.exit(1);
  }

  if (parsed.data.length === 0) {
    console.log("No events in file. Nothing to do.");
    await sqlClient.end();
    return;
  }

  try {
    // Fresh replace: simplest semantics for a seed dataset.
    await db.delete(events);

    for (const e of parsed.data) {
      let programId: string | null = null;
      if (e.program_slug) {
        const [row] = await db
          .select({ id: programs.id })
          .from(programs)
          .where(eq(programs.slug, e.program_slug))
          .limit(1);
        if (row) {
          programId = row.id;
        } else {
          console.warn(
            `Unknown program_slug "${e.program_slug}" for event "${e.name}"; inserting with null program_id`,
          );
        }
      }

      await db.insert(events).values({
        programId,
        name: e.name,
        description: e.description ?? null,
        startsAt: new Date(e.starts_at),
        endsAt: e.ends_at ? new Date(e.ends_at) : null,
        location: e.location ?? null,
        registrationUrl: e.registration_url ?? null,
        isPublic: e.is_public,
      });
    }
    console.log(`Inserted ${parsed.data.length} events.`);
  } finally {
    await sqlClient.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
