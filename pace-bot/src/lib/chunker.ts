const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 500;
const OVERLAP_TOKENS = 50;

const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

export interface Chunk {
  index: number;
  content: string;
}

export function chunkText(raw: string): Chunk[] {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buffer = "";

  const flush = () => {
    if (buffer.trim()) chunks.push(buffer.trim());
    buffer = "";
  };

  for (const para of paragraphs) {
    if (para.length > TARGET_CHARS) {
      flush();
      for (const piece of hardSplit(para, TARGET_CHARS, OVERLAP_CHARS)) {
        chunks.push(piece);
      }
      continue;
    }

    if (buffer.length + para.length + 2 <= TARGET_CHARS) {
      buffer = buffer ? `${buffer}\n\n${para}` : para;
    } else {
      flush();
      buffer = para;
    }
  }
  flush();

  return chunks.map((content, index) => ({ index, content }));
}

function hardSplit(text: string, size: number, overlap: number): string[] {
  const out: string[] = [];
  const step = Math.max(1, size - overlap);
  for (let start = 0; start < text.length; start += step) {
    out.push(text.slice(start, start + size));
    if (start + size >= text.length) break;
  }
  return out;
}
