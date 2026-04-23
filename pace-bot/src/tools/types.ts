import type { Tool } from "@anthropic-ai/sdk/resources/messages.mjs";
import type { Corpus } from "../db/schema.js";

export interface ToolContext {
  corpus: Corpus;
}

export interface ToolDefinition {
  definition: Tool;
  handler: (input: unknown, ctx: ToolContext) => Promise<string>;
}
