import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages.mjs";
import { avatarRegistry, type AvatarType } from "../avatars/registry.js";
import { env } from "../env.js";
import { getToolDefinitions, runTool } from "../tools/index.js";

const MAX_ITERATIONS = 6;
const MAX_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 20_000;

const client = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  timeout: REQUEST_TIMEOUT_MS,
});

const sessions = new Map<string, MessageParam[]>();

function getHistory(key: string): MessageParam[] {
  let history = sessions.get(key);
  if (!history) {
    history = [];
    sessions.set(key, history);
  }
  return history;
}

export interface ChatResult {
  reply: string;
  toolsUsed: string[];
}

export async function runChat(
  sessionId: string,
  avatarType: AvatarType,
  userMessage: string,
): Promise<ChatResult> {
  const config = avatarRegistry[avatarType];
  const historyKey = `${avatarType}:${sessionId}`;
  const history = getHistory(historyKey);
  history.push({ role: "user", content: userMessage });

  const tools = getToolDefinitions(config.allowedTools);
  const toolCtx = { corpus: config.corpus };
  const toolsUsed: string[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const resp = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      system: config.systemPrompt,
      tools,
      messages: history,
    });

    history.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason === "end_turn" || resp.stop_reason === "stop_sequence") {
      const text = resp.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { reply: text, toolsUsed };
    }

    if (resp.stop_reason === "tool_use") {
      const toolUses = resp.content.filter(
        (b): b is ToolUseBlock => b.type === "tool_use",
      );
      const results: ToolResultBlockParam[] = await Promise.all(
        toolUses.map(async (block) => {
          toolsUsed.push(block.name);
          const content = await runTool(block.name, block.input, toolCtx);
          return {
            type: "tool_result",
            tool_use_id: block.id,
            content,
          };
        }),
      );
      history.push({ role: "user", content: results });
      continue;
    }

    throw new Error(`Unexpected stop_reason: ${resp.stop_reason}`);
  }

  throw new Error(`Chat loop exceeded ${MAX_ITERATIONS} iterations`);
}
