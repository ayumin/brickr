import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./persistence/prisma.js";

async function main(): Promise<void> {
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
