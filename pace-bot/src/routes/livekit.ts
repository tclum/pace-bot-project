import type { FastifyInstance } from "fastify";
import { AccessToken } from "livekit-server-sdk";
import { z } from "zod";
import { avatarTypes } from "../avatars/registry.js";
import { env } from "../env.js";

const bodySchema = z.object({
  avatarType: z.enum(avatarTypes),
  sessionId: z.string().uuid(),
});

const AVATAR_ROOM_PREFIX: Record<(typeof avatarTypes)[number], string> = {
  pace_guide: "pace-guide",
  entrepreneurship_mentor: "pace-mentor",
};

export async function livekitRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/livekit-token", async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request body",
        details: parsed.error.issues,
      });
    }

    const { avatarType, sessionId } = parsed.data;

    const roomName = `${AVATAR_ROOM_PREFIX[avatarType]}-${sessionId}`;
    const identity = `user-${sessionId.slice(0, 8)}`;

    try {
      const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
        identity,
        metadata: JSON.stringify({ avatarType }),
        ttl: "10m",
      });
      at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
      });

      const token = await at.toJwt();
      return { token, room: roomName, serverUrl: env.LIVEKIT_URL };
    } catch (err) {
      app.log.error(
        { err, avatarType, sessionId },
        "Failed to mint LiveKit token",
      );
      return reply.code(502).send({ error: "Failed to mint LiveKit token" });
    }
  });
}
