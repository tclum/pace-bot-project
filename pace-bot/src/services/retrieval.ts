import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import type { Corpus } from "../db/schema.js";
import { embedOne } from "./embeddings.js";

export interface RetrievedChunk {
  id: string;
  documentId: string;
  source: string;
  title: string | null;
  chunkIndex: number;
  content: string;
  similarity: number;
}

export async function searchDocuments(
  query: string,
  topK: number,
  corpus: Corpus,
): Promise<RetrievedChunk[]> {
  const vector = await embedOne(query, "query");
  const literal = `[${vector.join(",")}]`;

  const rows = await db.execute<{
    id: string;
    document_id: string;
    source: string;
    title: string | null;
    chunk_index: number;
    content: string;
    distance: number;
  }>(sql`
    SELECT
      c.id,
      c.document_id,
      d.source,
      d.title,
      c.chunk_index,
      c.content,
      (c.embedding <=> ${literal}::vector) AS distance
    FROM document_chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.corpus = ${corpus}
    ORDER BY c.embedding <=> ${literal}::vector
    LIMIT ${topK}
  `);

  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    source: r.source,
    title: r.title,
    chunkIndex: r.chunk_index,
    content: r.content,
    similarity: 1 - Number(r.distance),
  }));
}
