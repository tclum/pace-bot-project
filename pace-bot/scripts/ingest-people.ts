import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { db, sqlClient } from "../src/db/client.js";
import { people } from "../src/db/schema.js";

const personSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  bio: z.string().nullish(),
  program_slugs: z.array(z.string()).default([]),
  email_public: z.string().email().nullish(),
  is_current: z.boolean().default(true),
});

const fileSchema = z.array(personSchema);

async function main() {
  const filePath =
    process.argv[2] ??
    fileURLToPath(new URL("../data/people.json", import.meta.url));
  const raw = await readFile(resolve(filePath), "utf8");
  const parsed = fileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error("Validation failed:", parsed.error.issues);
    process.exit(1);
  }

  if (parsed.data.length === 0) {
    console.log("No people in file. Nothing to do.");
    await sqlClient.end();
    return;
  }

  try {
    for (const p of parsed.data) {
      await db
        .insert(people)
        .values({
          slug: p.slug,
          name: p.name,
          role: p.role,
          bio: p.bio ?? null,
          programSlugs: p.program_slugs,
          emailPublic: p.email_public ?? null,
          isCurrent: p.is_current,
        })
        .onConflictDoUpdate({
          target: people.slug,
          set: {
            name: p.name,
            role: p.role,
            bio: p.bio ?? null,
            programSlugs: p.program_slugs,
            emailPublic: p.email_public ?? null,
            isCurrent: p.is_current,
          },
        });
    }
    console.log(`Upserted ${parsed.data.length} people.`);
  } finally {
    await sqlClient.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
