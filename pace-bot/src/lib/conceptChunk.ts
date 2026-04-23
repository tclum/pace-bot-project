export interface ConceptChunkInput {
  name: string;
  shortDefinition: string;
  longExplanation: string;
  pacificAsianContext?: string | null;
}

export function buildConceptChunk(c: ConceptChunkInput): string {
  const parts = [
    `# ${c.name}`,
    c.shortDefinition,
    c.longExplanation,
  ];
  if (c.pacificAsianContext) {
    parts.push(`Pacific-Asian context: ${c.pacificAsianContext}`);
  }
  return parts.join("\n\n");
}
