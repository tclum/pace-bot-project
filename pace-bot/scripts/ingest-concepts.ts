import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, sqlClient } from "../src/db/client.js";
import { concepts, documentChunks, documents } from "../src/db/schema.js";
import { buildConceptChunk } from "../src/lib/conceptChunk.js";
import { embed } from "../src/services/embeddings.js";

const exampleVentureSchema = z.object({
  name: z.string().min(1),
  note: z.string().optional(),
});

const conceptSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(["mindset", "framework", "cultural", "practice"]),
  short_definition: z.string().min(1).max(200),
  long_explanation: z.string().min(1),
  pacific_asian_context: z.string().nullish(),
  example_ventures: z.array(exampleVentureSchema).default([]),
  related_concept_slugs: z.array(z.string()).default([]),
});

const fileSchema = z.array(conceptSchema);

function sourceForSlug(slug: string): string {
  return `concept:${slug}`;
}

async function main() {
  const filePath =
    process.argv[2] ??
    fileURLToPath(new URL("../data/concepts.json", import.meta.url));
  const raw = await readFile(resolve(filePath), "utf8");
  const parsed = fileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error("Validation failed:", parsed.error.issues);
    process.exit(1);
  }

  const incoming = parsed.data;
  const incomingSlugs = incoming.map((c) => c.slug);

  try {
    // Remove concepts + associated synthetic documents that no longer appear.
    const stale = incomingSlugs.length
      ? await db
          .select({ slug: concepts.slug })
          .from(concepts)
          .where(notInArray(concepts.slug, incomingSlugs))
      : await db.select({ slug: concepts.slug }).from(concepts);

    if (stale.length > 0) {
      const staleSlugs = stale.map((r) => r.slug);
      await db.delete(concepts).where(inArray(concepts.slug, staleSlugs));
      await db
        .delete(documents)
        .where(
          inArray(
            documents.source,
            staleSlugs.map(sourceForSlug),
          ),
        );
      console.log(`Removed ${staleSlugs.length} stale concept(s).`);
    }

    if (incoming.length === 0) {
      console.log("No concepts in file. Done.");
      return;
    }

    // Embed all chunk texts in one batch.
    const chunkTexts = incoming.map((c) =>
      buildConceptChunk({
        name: c.name,
        shortDefinition: c.short_definition,
        longExplanation: c.long_explanation,
        pacificAsianContext: c.pacific_asian_context ?? null,
      }),
    );
    console.log(`Embedding ${chunkTexts.length} concept chunks...`);
    const vectors = await embed(chunkTexts, "document");

    for (let i = 0; i < incoming.length; i++) {
      const c = incoming[i]!;
      const embedding = vectors[i]!;
      const chunkText = chunkTexts[i]!;
      const source = sourceForSlug(c.slug);

      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(concepts)
          .values({
            slug: c.slug,
            name: c.name,
            category: c.category,
            shortDefinition: c.short_definition,
            longExplanation: c.long_explanation,
            pacificAsianContext: c.pacific_asian_context ?? null,
            exampleVentures: c.example_ventures,
            relatedConceptSlugs: c.related_concept_slugs,
          })
          .onConflictDoUpdate({
            target: concepts.slug,
            set: {
              name: c.name,
              category: c.category,
              shortDefinition: c.short_definition,
              longExplanation: c.long_explanation,
              pacificAsianContext: c.pacific_asian_context ?? null,
              exampleVentures: c.example_ventures,
              relatedConceptSlugs: c.related_concept_slugs,
              updatedAt: new Date(),
            },
          })
          .returning({ id: concepts.id });
        if (!row) throw new Error(`Upsert for concept ${c.slug} returned no row`);
        const conceptId = row.id;

        const [existingDoc] = await tx
          .select({ id: documents.id })
          .from(documents)
          .where(and(eq(documents.source, source), eq(documents.corpus, "curriculum")))
          .limit(1);

        let docId: string;
        if (existingDoc) {
          docId = existingDoc.id;
          await tx
            .delete(documentChunks)
            .where(eq(documentChunks.documentId, docId));
        } else {
          const [newDoc] = await tx
            .insert(documents)
            .values({
              source,
              title: c.name,
              corpus: "curriculum",
            })
            .returning({ id: documents.id });
          if (!newDoc) throw new Error("Failed to insert concept document");
          docId = newDoc.id;
        }

        await tx.insert(documentChunks).values({
          documentId: docId,
          chunkIndex: 0,
          content: chunkText,
          embedding,
          corpus: "curriculum",
          metadata: sql`${JSON.stringify({
            source_type: "concept",
            concept_slug: c.slug,
            concept_id: conceptId,
          })}::jsonb`,
        });
      });
    }

    console.log(`Upserted ${incoming.length} concepts with curriculum chunks.`);
  } finally {
    await sqlClient.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
