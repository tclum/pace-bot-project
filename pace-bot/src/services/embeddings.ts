import { env } from "../env.js";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const BATCH_SIZE = 128;
const TIMEOUT_MS = 5_000;

export type VoyageInputType = "document" | "query";

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
  model: string;
  usage: { total_tokens: number };
}

async function embedBatch(
  texts: string[],
  inputType: VoyageInputType,
): Promise<number[][]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: texts,
        model: env.VOYAGE_MODEL,
        input_type: inputType,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Voyage API ${res.status}: ${body}`);
    }

    const json = (await res.json()) as VoyageResponse;
    return json.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  } finally {
    clearTimeout(timer);
  }
}

export async function embed(
  texts: string[],
  inputType: VoyageInputType = "document",
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const vectors = await embedBatch(batch, inputType);
    out.push(...vectors);
  }
  return out;
}

export async function embedOne(
  text: string,
  inputType: VoyageInputType = "query",
): Promise<number[]> {
  const [vec] = await embed([text], inputType);
  if (!vec) throw new Error("Voyage returned no embedding");
  return vec;
}
