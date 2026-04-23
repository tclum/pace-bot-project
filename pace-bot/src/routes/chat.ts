import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { avatarTypes } from "../avatars/registry.js";
import { runChat } from "../services/anthropic.js";

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  avatarType: z.enum(avatarTypes),
  message: z.string().min(1).max(2000),
});

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/chat", async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request body",
        details: parsed.error.issues,
      });
    }

    const { sessionId, avatarType, message } = parsed.data;
    const started = Date.now();

    try {
      const result = await runChat(sessionId, avatarType, message);
      app.log.info(
        {
          sessionId,
          avatarType,
          toolsUsed: result.toolsUsed,
          latencyMs: Date.now() - started,
        },
        "chat complete",
      );
      return result;
    } catch (err) {
      app.log.error({ err, sessionId, avatarType }, "chat failed");
      return reply.code(502).send({ error: "Chat request failed" });
    }
  });
}
