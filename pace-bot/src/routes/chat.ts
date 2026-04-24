import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { avatarTypes } from "../avatars/registry.js";
import { requirePassword } from "../middleware/password.js";
import { runChat, runRawClaude } from "../services/anthropic.js";

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  avatarType: z.enum(avatarTypes),
  message: z.string().min(1).max(4000),
  mode: z.enum(["guarded", "unguarded", "raw"]).default("guarded"),
});

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/chat", { preHandler: requirePassword }, async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request body",
        details: parsed.error.issues,
      });
    }

    const { sessionId, avatarType, message, mode } = parsed.data;
    const started = Date.now();

    try {
      let replyText: string;
      let toolsUsed: string[];

      if (mode === "raw") {
        const result = await runRawClaude(message);
        replyText = result.reply;
        toolsUsed = [];
      } else {
        const result = await runChat(sessionId, avatarType, message, {
          unguarded: mode === "unguarded",
        });
        replyText = result.reply;
        toolsUsed = result.toolsUsed;
      }

      app.log.info(
        {
          sessionId,
          avatarType,
          mode,
          toolsUsed,
          latencyMs: Date.now() - started,
        },
        "chat complete",
      );
      return { reply: replyText, toolsUsed, mode };
    } catch (err) {
      app.log.error({ err, sessionId, avatarType, mode }, "chat failed");
      return reply.code(502).send({ error: "Chat request failed" });
    }
  });
}
