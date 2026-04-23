import type { Tool } from "@anthropic-ai/sdk/resources/messages.mjs";
import { findPersonTool } from "./findPerson.js";
import { getConceptTool } from "./getConcept.js";
import { getProgramTool } from "./getProgram.js";
import { getRelatedConceptsTool } from "./getRelatedConcepts.js";
import { getUpcomingEventsTool } from "./getUpcomingEvents.js";
import { listConceptsTool } from "./listConcepts.js";
import { listProgramsTool } from "./listPrograms.js";
import { searchDocumentsTool } from "./searchDocuments.js";
import type { ToolContext, ToolDefinition } from "./types.js";

const registry: Record<string, ToolDefinition> = {
  search_documents: searchDocumentsTool,
  list_programs: listProgramsTool,
  get_program: getProgramTool,
  get_upcoming_events: getUpcomingEventsTool,
  find_person: findPersonTool,
  list_concepts: listConceptsTool,
  get_concept: getConceptTool,
  get_related_concepts: getRelatedConceptsTool,
};

export function getToolDefinitions(allowed: readonly string[]): Tool[] {
  return allowed
    .map((name) => registry[name]?.definition)
    .filter((t): t is Tool => Boolean(t));
}

export async function runTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<string> {
  const entry = registry[name];
  if (!entry) return `Error: unknown tool "${name}"`;
  try {
    return await entry.handler(input, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error running tool "${name}": ${message}`;
  }
}

export type { ToolContext } from "./types.js";
