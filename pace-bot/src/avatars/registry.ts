import { env } from "../env.js";
import type { Corpus } from "../db/schema.js";
import { MENTOR_PROMPT, PACE_GUIDE_PROMPT } from "./prompts.js";

export const avatarTypes = ["pace_guide", "entrepreneurship_mentor"] as const;
export type AvatarType = (typeof avatarTypes)[number];

export interface AvatarConfig {
  systemPrompt: string;
  allowedTools: string[];
  corpus: Corpus;
  heygenAvatarId: string;
  heygenVoiceId?: string;
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
    heygenAvatarId: env.HEYGEN_AVATAR_ID_PACE_GUIDE ?? env.HEYGEN_AVATAR_ID,
    heygenVoiceId: env.HEYGEN_VOICE_ID_PACE_GUIDE ?? env.HEYGEN_VOICE_ID,
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
    heygenAvatarId: env.HEYGEN_AVATAR_ID_MENTOR ?? env.HEYGEN_AVATAR_ID,
    heygenVoiceId: env.HEYGEN_VOICE_ID_MENTOR ?? env.HEYGEN_VOICE_ID,
  },
};

export function isAvatarType(value: unknown): value is AvatarType {
  return (
    typeof value === "string" &&
    (avatarTypes as readonly string[]).includes(value)
  );
}
