import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduledEventRepository } from "../scheduled-events/scheduled-event-repository.js";
import { startHealthServer } from "./health-server.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const servers: ReturnType<typeof startHealthServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

async function start(countByStatus: () => Promise<unknown>) {
  const server = startHealthServer(
    "127.0.0.1",
    0,
    { workerId: "worker-test", lastPollAt: null, lastSuccessAt: null },
    { countByStatus } as unknown as ScheduledEventRepository,
    logger,
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${String(port)}/health`);
}

describe("worker health endpoint", () => {
  it("returns 200 when queue state is readable", async () => {
    const response = await start(() =>
      Promise.resolve({ pending: 1, processing: 2, completed: 3, failed: 4, cancelled: 5 }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      queueDepth: { pending: 1, processing: 2, failed: 4 },
    });
  });

  it("returns 503 when the database cannot be queried", async () => {
    const response = await start(() => Promise.reject(new Error("database unavailable")));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "error",
      queueDepth: null,
      error: "database unavailable",
    });
  });
});
