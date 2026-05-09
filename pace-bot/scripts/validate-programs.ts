import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

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

const filePath =
  process.argv[2] ??
  fileURLToPath(new URL("../data/programs.json", import.meta.url));
const raw = await readFile(resolve(filePath), "utf8");
const json = JSON.parse(raw);
const parsed = fileSchema.safeParse(json);

if (!parsed.success) {
  console.error("VALIDATION FAILED:");
  console.error(JSON.stringify(parsed.error.issues, null, 2));
  process.exit(1);
}

console.log(`VALIDATION OK: ${parsed.data.length} programs`);
const byCat: Record<string, number> = {};
for (const p of parsed.data) {
  byCat[p.category] = (byCat[p.category] ?? 0) + 1;
}
console.log("By category:", byCat);
