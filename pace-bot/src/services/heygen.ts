import { env } from "../env.js";

const TOKEN_URL = "https://api.heygen.com/v1/streaming.create_token";
const TIMEOUT_MS = 5_000;

interface HeyGenTokenResponse {
  data?: { token?: string };
  error?: string;
}

export interface CreateTokenArgs {
  avatarId: string;
  voiceId?: string;
}

export async function createStreamingToken(
  args: CreateTokenArgs,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const body: Record<string, unknown> = { avatar_id: args.avatarId };
  if (args.voiceId) body.voice = { voice_id: args.voiceId };

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "X-Api-Key": env.HEYGEN_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HeyGen token request failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as HeyGenTokenResponse;
    const token = json.data?.token;
    if (!token) {
      throw new Error(`HeyGen response missing token: ${JSON.stringify(json)}`);
    }
    return token;
  } finally {
    clearTimeout(timer);
  }
}
