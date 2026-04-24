import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { env } from "./env.js";
import { chatRoutes } from "./routes/chat.js";
import { livekitRoutes } from "./routes/livekit.js";

async function build() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
    },
    bodyLimit: 64 * 1024,
  });

  const allowedOrigins = env.ALLOWED_ORIGIN.split(",").map((o) => o.trim());

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS"), false);
    },
    methods: ["GET", "POST", "OPTIONS"],
  });

  await app.register(rateLimit, {
    max: 60,
    timeWindow: "1 minute",
    allowList: ["127.0.0.1"],
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  await app.register(chatRoutes);
  await app.register(livekitRoutes);

  return app;
}

async function main() {
  const app = await build();
  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
