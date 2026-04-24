import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../env.js";

export async function requirePassword(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = req.headers["x-app-password"];
  const provided = Array.isArray(header) ? header[0] : header;

  if (!provided || provided !== env.APP_PASSWORD) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
}
