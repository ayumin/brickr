import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./persistence/prisma.js";
import { RoomRepository } from "./rooms/room-repository.js";

async function main(): Promise<void> {
  // The unified feed posts into this room directly (§10.4); guaranteed here
  // rather than relying solely on `prisma/seed.ts`, which is not guaranteed to
  // run against every database (e.g. a deploy that only runs migrations).
  await new RoomRepository(prisma).ensureDefaultRoom();

  const app = await buildApp(prisma);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: env.port, host: env.host });
  app.log.info({ port: env.port, host: env.host }, "backend ready");
}

main().catch((error: unknown) => {
  console.error("failed to start backend", error);
  process.exit(1);
});
