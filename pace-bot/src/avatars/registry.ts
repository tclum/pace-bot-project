import type { Corpus } from "../db/schema.js";
import { MENTOR_PROMPT, PACE_GUIDE_PROMPT } from "./prompts.js";

export const avatarTypes = ["pace_guide", "entrepreneurship_mentor"] as const;
export type AvatarType = (typeof avatarTypes)[number];

export interface AvatarConfig {
  systemPrompt: string;
  allowedTools: string[];
  corpus: Corpus;
}

export const avatarRegistry: Record<AvatarType, AvatarConfig> = {
  pace_guide: {
    systemPrompt: PACE_GUIDE_PROMPT,
    allowedTools: [
      "search_documents",
      "list_programs",
      "get_program",
      "get_upcoming_events",
      "find_person",
    ],
    corpus: "org",
  },
  entrepreneurship_mentor: {
    systemPrompt: MENTOR_PROMPT,
    allowedTools: [
      "search_documents",
      "list_concepts",
      "get_concept",
      "get_related_concepts",
    ],
    corpus: "curriculum",
  },
};

export function isAvatarType(value: unknown): value is AvatarType {
  return (
    typeof value === "string" &&
    (avatarTypes as readonly string[]).includes(value)
  );
}
