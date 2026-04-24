import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ALLOWED_ORIGIN: z
    .string()
    .min(1)
    .refine(
      (v) =>
        v.split(",").every((o) => {
          try {
            new URL(o.trim());
            return true;
          } catch {
            return false;
          }
        }),
      { message: "must be a URL or comma-separated list of URLs" },
    ),

  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-opus-4-7"),

  VOYAGE_API_KEY: z.string().min(1),
  VOYAGE_MODEL: z.string().min(1).default("voyage-3"),

  DATABASE_URL: z.string().url(),

  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
