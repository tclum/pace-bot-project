import { z } from "zod";
import { searchDocuments } from "../services/retrieval.js";
import type { ToolDefinition } from "./types.js";

const inputSchema = z.object({
  query: z.string().min(1).max(1000),
  top_k: z.number().int().min(1).max(10).default(5),
});

export const searchDocumentsTool: ToolDefinition = {
  definition: {
    name: "search_documents",
    description:
      "Search the company's knowledge base of documents, FAQs, and policy pages. Use for unstructured or text-based questions (how-tos, policies, explanations, background info).",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Semantic search query" },
        top_k: { type: "integer", default: 5, maximum: 10 },
      },
      required: ["query"],
    },
  },
  handler: async (raw, ctx) => {
    const input = inputSchema.parse(raw);
    const hits = await searchDocuments(input.query, input.top_k, ctx.corpus);

    if (hits.length === 0) {
      return "No matching documents found.";
    }

    return hits
      .map((hit, i) => {
        const label = hit.title ?? hit.source;
        return `[${i + 1}] ${label} (chunk ${hit.chunkIndex}, similarity=${hit.similarity.toFixed(3)})\n${hit.content}`;
      })
      .join("\n\n---\n\n");
  },
};
