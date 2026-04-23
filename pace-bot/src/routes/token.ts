import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { avatarRegistry, avatarTypes } from "../avatars/registry.js";
import { createStreamingToken } from "../services/heygen.js";

const bodySchema = z.object({
  avatarType: z.enum(avatarTypes),
});

export async function tokenRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/token", async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request body",
        details: parsed.error.issues,
      });
    }

    const config = avatarRegistry[parsed.data.avatarType];

    try {
      const token = await createStreamingToken({
        avatarId: config.heygenAvatarId,
        voiceId: config.heygenVoiceId,
      });
      return { token };
    } catch (err) {
      app.log.error(
        { err, avatarType: parsed.data.avatarType },
        "Failed to create HeyGen token",
      );
      return reply.code(502).send({ error: "Failed to create HeyGen token" });
    }
  });
}
