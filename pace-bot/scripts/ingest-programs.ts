import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { db, sqlClient } from "../src/db/client.js";
import { programs } from "../src/db/schema.js";

const programSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  category: z.enum([
    "accelerator",
    "competition",
    "leadership",
    "workshop",
    "grant",
    "other",
  ]),
  short_description: z.string().min(1),
  long_description: z.string().nullish(),
  eligibility: z.string().nullish(),
  application_url: z.string().url().nullish(),
  next_deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .nullish(),
  award_amount_min: z.number().int().nonnegative().nullish(),
  award_amount_max: z.number().int().nonnegative().nullish(),
  is_active: z.boolean().default(true),
});

const fileSchema = z.array(programSchema);

async function main() {
  const filePath =
    process.argv[2] ??
    fileURLToPath(new URL("../data/programs.json", import.meta.url));
  const raw = await readFile(resolve(filePath), "utf8");
  const parsed = fileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error("Validation failed:", parsed.error.issues);
    process.exit(1);
  }

  if (parsed.data.length === 0) {
    console.log("No programs in file. Nothing to do.");
    await sqlClient.end();
    return;
  }

  try {
    for (const p of parsed.data) {
      await db
        .insert(programs)
        .values({
          slug: p.slug,
          name: p.name,
          category: p.category,
          shortDescription: p.short_description,
          longDescription: p.long_description ?? null,
          eligibility: p.eligibility ?? null,
          applicationUrl: p.application_url ?? null,
          nextDeadline: p.next_deadline ?? null,
          awardAmountMin: p.award_amount_min ?? null,
          awardAmountMax: p.award_amount_max ?? null,
          isActive: p.is_active,
        })
        .onConflictDoUpdate({
          target: programs.slug,
          set: {
            name: p.name,
            category: p.category,
            shortDescription: p.short_description,
            longDescription: p.long_description ?? null,
            eligibility: p.eligibility ?? null,
            applicationUrl: p.application_url ?? null,
            nextDeadline: p.next_deadline ?? null,
            awardAmountMin: p.award_amount_min ?? null,
            awardAmountMax: p.award_amount_max ?? null,
            isActive: p.is_active,
            updatedAt: new Date(),
          },
        });
    }
    console.log(`Upserted ${parsed.data.length} programs.`);
  } finally {
    await sqlClient.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
