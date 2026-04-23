import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { db, sqlClient } from "../src/db/client.js";
import { documentChunks, documents } from "../src/db/schema.js";
import { chunkText } from "../src/lib/chunker.js";
import { embed } from "../src/services/embeddings.js";
import { corpusValues, type Corpus } from "../src/db/schema.js";

const SUPPORTED = new Set([".md", ".txt"]);

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      title: { type: "string" },
      corpus: { type: "string", default: "org" },
    },
  });

  const filePath = positionals[0];
  if (!filePath) {
    console.error(
      "Usage: npm run ingest -- <file.md> [--title \"Title\"] [--corpus org|curriculum]",
    );
    process.exit(1);
  }

  if (!(corpusValues as readonly string[]).includes(values.corpus ?? "org")) {
    console.error(
      `Invalid --corpus: "${values.corpus}". Expected one of: ${corpusValues.join(", ")}`,
    );
    process.exit(1);
  }
  const corpus = (values.corpus ?? "org") as Corpus;

  const absPath = resolve(filePath);
  const ext = extname(absPath).toLowerCase();
  if (!SUPPORTED.has(ext)) {
    console.error(`Unsupported file type: ${ext}. Supported: ${[...SUPPORTED].join(", ")}`);
    process.exit(1);
  }

  const raw = await readFile(absPath, "utf8");
  const chunks = chunkText(raw);
  if (chunks.length === 0) {
    console.error("No content to ingest (file is empty after trimming).");
    process.exit(1);
  }

  console.log(`Embedding ${chunks.length} chunks from ${absPath}...`);
  const vectors = await embed(
    chunks.map((c) => c.content),
    "document",
  );

  const title = values.title ?? basename(absPath);
  const source = absPath;

  try {
    await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({ source, title, corpus })
        .returning({ id: documents.id });
      if (!doc) throw new Error("Failed to insert document row");

      await tx.insert(documentChunks).values(
        chunks.map((c, i) => {
          const embedding = vectors[i];
          if (!embedding) throw new Error(`Missing embedding for chunk ${i}`);
          return {
            documentId: doc.id,
            chunkIndex: c.index,
            content: c.content,
            embedding,
            corpus,
          };
        }),
      );

      console.log(
        `Inserted document ${doc.id} (corpus=${corpus}) with ${chunks.length} chunks.`,
      );
    });
  } finally {
    await sqlClient.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
